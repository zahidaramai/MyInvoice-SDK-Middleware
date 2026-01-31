/**
 * User Management API routes
 */

import type { FastifyInstance } from "fastify";
import {
  findUserByIdWithCompanies,
  updateUser,
  deleteUser,
  listUsers,
  emailExists,
  userExists,
  linkUserToCompany,
  unlinkUserFromCompany,
  roleExists,
  companyExists,
  isUserLinkedToCompany,
  findRoleById,
  parsePermissions,
  getPrismaClient,
} from "@myinvois/storage";
import { hashPassword } from "../auth/password.js";
import { authenticate, requirePermission, SUPERADMIN_PERMISSION } from "../auth/middleware.js";

/**
 * Check if a role is the protected Superadmin role
 * Cannot be assigned via API - only via direct database access
 */
async function isSuperadminRoleId(roleId: string): Promise<boolean> {
  const role = await findRoleById(roleId);
  if (!role) return false;
  const perms = parsePermissions(role);
  return role.name === "Superadmin" || perms.includes(SUPERADMIN_PERMISSION);
}

/**
 * Check if a user has the Superadmin role.
 * Superadmin users cannot be viewed, edited, or deleted via the management API.
 */
async function isUserSuperadmin(userId: string): Promise<boolean> {
  const user = await findUserByIdWithCompanies(userId);
  if (!user) return false;
  const perms = parsePermissions(user.role);
  return user.role.name === "Superadmin" || perms.includes(SUPERADMIN_PERMISSION);
}

/**
 * Create user request body
 */
interface CreateUserBody {
  email: string;
  password: string;
  name: string;
  roleId: string;
  isActive?: boolean;
  companyIds?: string[];
}

/**
 * Update user request body
 */
interface UpdateUserBody {
  email?: string;
  password?: string;
  name?: string;
  roleId?: string;
  isActive?: boolean;
}

/**
 * List users query params
 */
interface ListUsersQuery {
  page?: number;
  limit?: number;
  search?: string;
  roleId?: string;
  isActive?: string;
}

/**
 * Register user management routes
 */
export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply authentication and permission to all routes
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", requirePermission("manage:users"));

  /**
   * GET /api/v1/users
   * List users with pagination
   */
  fastify.get<{ Querystring: ListUsersQuery }>(
    "/",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            page: { type: "number", minimum: 1 },
            limit: { type: "number", minimum: 1, maximum: 100 },
            search: { type: "string" },
            roleId: { type: "string" },
            isActive: { type: "string", enum: ["true", "false"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { page, limit, search, roleId, isActive } = request.query;

      const result = await listUsers({
        page: page || 1,
        limit: limit || 20,
        search,
        roleId,
        isActive: isActive ? isActive === "true" : undefined,
      });

      // Filter out superadmin users - they are not manageable via the UI
      const filteredData = result.data.filter((user) => {
        const perms = parsePermissions(user.role);
        return user.role.name !== "Superadmin" && !perms.includes(SUPERADMIN_PERMISSION);
      });

      return reply.send({
        data: filteredData.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          role: {
            id: user.role.id,
            name: user.role.name,
          },
          isActive: user.isActive,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        })),
        pagination: {
          total: result.total - (result.data.length - filteredData.length),
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil((result.total - (result.data.length - filteredData.length)) / result.limit),
        },
      });
    }
  );

  /**
   * POST /api/v1/users
   * Create a new user
   */
  fastify.post<{ Body: CreateUserBody }>(
    "/",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password", "name", "roleId"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            name: { type: "string", minLength: 1 },
            roleId: { type: "string" },
            isActive: { type: "boolean" },
            companyIds: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password, name, roleId, isActive, companyIds } = request.body;

      // Check if email already exists
      if (await emailExists(email)) {
        return reply.status(400).send({
          error: {
            code: "EMAIL_EXISTS",
            message: "Email already exists",
          },
        });
      }

      // Check if role exists
      if (!(await roleExists(roleId))) {
        return reply.status(400).send({
          error: {
            code: "ROLE_NOT_FOUND",
            message: "Role not found",
          },
        });
      }

      // Prevent assigning Superadmin role via API
      if (await isSuperadminRoleId(roleId)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Cannot assign Superadmin role via API. This role can only be assigned via direct database access.",
          },
        });
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // P2-12: Create user and link companies in a transaction
      const prisma = getPrismaClient();
      const user = await prisma.$transaction(async (tx) => {
        // Create user
        const newUser = await tx.user.create({
          data: {
            email,
            passwordHash,
            name,
            roleId,
            isActive,
          },
          include: {
            role: true,
          },
        });

        // Link user to companies if provided
        if (companyIds && companyIds.length > 0) {
          // Validate all companies exist first
          const validCompanyIds: string[] = [];
          for (const companyId of companyIds) {
            const exists = await tx.company.findUnique({ where: { id: companyId } });
            if (exists) {
              validCompanyIds.push(companyId);
            }
          }

          // Link all valid companies
          if (validCompanyIds.length > 0) {
            await tx.userCompany.createMany({
              data: validCompanyIds.map((companyId) => ({
                userId: newUser.id,
                companyId,
              })),
              skipDuplicates: true,
            });
          }
        }

        return newUser;
      });

      return reply.status(201).send({
        id: user.id,
        email: user.email,
        name: user.name,
        role: {
          id: user.role.id,
          name: user.role.name,
        },
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
      });
    }
  );

  /**
   * GET /api/v1/users/:id
   * Get user by ID
   */
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Block access to superadmin user details
      if (await isUserSuperadmin(id)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Superadmin user cannot be viewed or modified via the management API.",
          },
        });
      }

      const user = await findUserByIdWithCompanies(id);

      if (!user) {
        return reply.status(404).send({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        role: {
          id: user.role.id,
          name: user.role.name,
        },
        companies: user.companies.map((uc) => ({
          id: uc.company.id,
          name: uc.company.name,
          tin: uc.company.tin,
        })),
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      });
    }
  );

  /**
   * PUT /api/v1/users/:id
   * Update user
   */
  fastify.put<{ Params: { id: string }; Body: UpdateUserBody }>(
    "/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        body: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            name: { type: "string", minLength: 1 },
            roleId: { type: "string" },
            isActive: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { email, password, name, roleId, isActive } = request.body;

      // Block modification of superadmin users
      if (await isUserSuperadmin(id)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Superadmin user cannot be modified via the management API.",
          },
        });
      }

      // Check if user exists
      if (!(await userExists(id))) {
        return reply.status(404).send({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      // Check if email already taken by another user
      if (email && (await emailExists(email, id))) {
        return reply.status(400).send({
          error: {
            code: "EMAIL_EXISTS",
            message: "Email already exists",
          },
        });
      }

      // Check if role exists
      if (roleId && !(await roleExists(roleId))) {
        return reply.status(400).send({
          error: {
            code: "ROLE_NOT_FOUND",
            message: "Role not found",
          },
        });
      }

      // Prevent assigning Superadmin role via API
      if (roleId && (await isSuperadminRoleId(roleId))) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Cannot assign Superadmin role via API. This role can only be assigned via direct database access.",
          },
        });
      }

      // Build update data
      const updateData: {
        email?: string;
        passwordHash?: string;
        name?: string;
        roleId?: string;
        isActive?: boolean;
      } = {};

      if (email !== undefined) updateData.email = email;
      if (name !== undefined) updateData.name = name;
      if (roleId !== undefined) updateData.roleId = roleId;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (password) updateData.passwordHash = await hashPassword(password);

      const user = await updateUser(id, updateData);

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        role: {
          id: user.role.id,
          name: user.role.name,
        },
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      });
    }
  );

  /**
   * DELETE /api/v1/users/:id
   * Delete user
   */
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Block deletion of superadmin users
      if (await isUserSuperadmin(id)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Superadmin user cannot be deleted.",
          },
        });
      }

      // Prevent self-deletion
      if (request.user?.userId === id) {
        return reply.status(400).send({
          error: {
            code: "CANNOT_DELETE_SELF",
            message: "Cannot delete your own account",
          },
        });
      }

      if (!(await userExists(id))) {
        return reply.status(404).send({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      await deleteUser(id);

      return reply.status(204).send();
    }
  );

  /**
   * POST /api/v1/users/:id/companies/:companyId
   * Link user to company
   */
  fastify.post<{ Params: { id: string; companyId: string } }>(
    "/:id/companies/:companyId",
    {
      schema: {
        params: {
          type: "object",
          required: ["id", "companyId"],
          properties: {
            id: { type: "string" },
            companyId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id, companyId } = request.params;

      // Block modification of superadmin users
      if (await isUserSuperadmin(id)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Superadmin user cannot be modified via the management API.",
          },
        });
      }

      if (!(await userExists(id))) {
        return reply.status(404).send({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      if (!(await companyExists(companyId))) {
        return reply.status(404).send({
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        });
      }

      if (await isUserLinkedToCompany(id, companyId)) {
        return reply.status(400).send({
          error: {
            code: "ALREADY_LINKED",
            message: "User already linked to company",
          },
        });
      }

      await linkUserToCompany(id, companyId);

      return reply.status(201).send({
        message: "User linked to company successfully",
      });
    }
  );

  /**
   * PUT /api/v1/users/:id/role
   * Assign role to user
   */
  fastify.put<{ Params: { id: string }; Body: { roleId: string } }>(
    "/:id/role",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["roleId"],
          properties: {
            roleId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { roleId } = request.body;

      // Block role change for superadmin users
      if (await isUserSuperadmin(id)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Superadmin user's role cannot be changed.",
          },
        });
      }

      if (!(await userExists(id))) {
        return reply.status(404).send({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      if (!(await roleExists(roleId))) {
        return reply.status(400).send({
          error: {
            code: "ROLE_NOT_FOUND",
            message: "Role not found",
          },
        });
      }

      // Prevent assigning Superadmin role via API
      if (await isSuperadminRoleId(roleId)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Cannot assign Superadmin role via API. This role can only be assigned via direct database access.",
          },
        });
      }

      const user = await updateUser(id, { roleId });

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        role: {
          id: user.role.id,
          name: user.role.name,
        },
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      });
    }
  );

  /**
   * DELETE /api/v1/users/:id/companies/:companyId
   * Unlink user from company
   */
  fastify.delete<{ Params: { id: string; companyId: string } }>(
    "/:id/companies/:companyId",
    {
      schema: {
        params: {
          type: "object",
          required: ["id", "companyId"],
          properties: {
            id: { type: "string" },
            companyId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id, companyId } = request.params;

      // Block modification of superadmin users
      if (await isUserSuperadmin(id)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Superadmin user cannot be modified via the management API.",
          },
        });
      }

      if (!(await isUserLinkedToCompany(id, companyId))) {
        return reply.status(404).send({
          error: {
            code: "NOT_LINKED",
            message: "User is not linked to this company",
          },
        });
      }

      await unlinkUserFromCompany(id, companyId);

      return reply.status(204).send();
    }
  );
}
