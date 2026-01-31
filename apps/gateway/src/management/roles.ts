/**
 * Role Management API routes
 */

import type { FastifyInstance } from "fastify";
import {
  createRole,
  findRoleById,
  updateRole,
  deleteRole,
  listRoles,
  roleNameExists,
  roleHasUsers,
  getAllRoles,
  parsePermissions,
} from "@myinvois/storage";
import { authenticate, requirePermission } from "../auth/middleware.js";

/**
 * Superadmin permission - cannot be assigned via API, only via direct database access
 * This prevents privilege escalation attacks
 */
const SUPERADMIN_PERMISSION = "*";

/**
 * Available permissions in the system (excludes superadmin)
 * The superadmin permission "*" is intentionally not listed here
 * to prevent creation/assignment via API
 */
const AVAILABLE_PERMISSIONS = [
  "submit:invoice",
  "read:documents",
  "cancel:documents",
  "manage:users",
  "manage:roles",
  "manage:companies",
];

/**
 * Check if a role has superadmin permission
 */
function hasSuperadminPermission(permissions: string[]): boolean {
  return permissions.includes(SUPERADMIN_PERMISSION);
}

/**
 * Check if a role is the protected Superadmin role
 */
function isSuperadminRole(role: { name: string; permissions: string | string[] | null }): boolean {
  let perms: string[] = [];
  if (typeof role.permissions === "string") {
    try {
      perms = JSON.parse(role.permissions);
    } catch {
      perms = [];
    }
  } else if (Array.isArray(role.permissions)) {
    perms = role.permissions;
  }
  return role.name === "Superadmin" || perms.includes(SUPERADMIN_PERMISSION);
}

/**
 * Create role request body
 */
interface CreateRoleBody {
  name: string;
  permissions: string[];
  description?: string;
}

/**
 * Update role request body
 */
interface UpdateRoleBody {
  name?: string;
  permissions?: string[];
  description?: string;
}

/**
 * List roles query params
 */
interface ListRolesQuery {
  page?: number;
  limit?: number;
  search?: string;
}

/**
 * Register role management routes
 */
export async function rolesRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply authentication and permission to all routes
  fastify.addHook("preHandler", authenticate);
  fastify.addHook("preHandler", requirePermission("manage:roles"));

  /**
   * GET /api/v1/roles
   * List roles with pagination
   */
  fastify.get<{ Querystring: ListRolesQuery }>(
    "/",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            page: { type: "number", minimum: 1 },
            limit: { type: "number", minimum: 1, maximum: 100 },
            search: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { page, limit, search } = request.query;

      const result = await listRoles({
        page: page || 1,
        limit: limit || 20,
        search,
      });

      // Filter out Superadmin role from listing (can only be managed via database)
      const filteredData = result.data.filter((role) => !isSuperadminRole(role));

      return reply.send({
        data: filteredData.map((role) => ({
          id: role.id,
          name: role.name,
          permissions: parsePermissions(role),
          description: role.description,
          userCount: role.userCount,
          createdAt: role.createdAt.toISOString(),
          updatedAt: role.updatedAt.toISOString(),
        })),
        pagination: {
          total: result.total - (result.data.length - filteredData.length),
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    }
  );

  /**
   * GET /api/v1/roles/all
   * Get all roles (for dropdowns)
   * Note: Superadmin role is excluded - can only be managed via database
   */
  fastify.get("/all", async (_request, reply) => {
    const roles = await getAllRoles();

    // Filter out Superadmin role (can only be managed via database)
    const filteredRoles = roles.filter((role) => !isSuperadminRole(role));

    return reply.send({
      data: filteredRoles.map((role) => ({
        id: role.id,
        name: role.name,
        permissions: parsePermissions(role),
        description: role.description,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      })),
    });
  });

  /**
   * GET /api/v1/roles/permissions
   * Get available permissions
   */
  fastify.get("/permissions", async (_request, reply) => {
    return reply.send({
      permissions: AVAILABLE_PERMISSIONS,
    });
  });

  /**
   * POST /api/v1/roles
   * Create a new role
   */
  fastify.post<{ Body: CreateRoleBody }>(
    "/",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "permissions"],
          properties: {
            name: { type: "string", minLength: 1 },
            permissions: {
              type: "array",
              items: { type: "string" },
            },
            description: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, permissions, description } = request.body;

      // Prevent creating role named "Superadmin" or with superadmin permission
      if (name.toLowerCase() === "superadmin") {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Cannot create Superadmin role via API. This role can only be managed via direct database access.",
          },
        });
      }

      if (hasSuperadminPermission(permissions)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PERMISSION_PROTECTED",
            message: "Cannot assign superadmin permission via API. This permission can only be assigned via direct database access.",
          },
        });
      }

      // Check if name already exists
      if (await roleNameExists(name)) {
        return reply.status(400).send({
          error: {
            code: "ROLE_NAME_EXISTS",
            message: "Role name already exists",
          },
        });
      }

      // Validate permissions
      const invalidPermissions = permissions.filter(
        (p) => !AVAILABLE_PERMISSIONS.includes(p)
      );

      if (invalidPermissions.length > 0) {
        return reply.status(400).send({
          error: {
            code: "INVALID_PERMISSIONS",
            message: `Invalid permissions: ${invalidPermissions.join(", ")}`,
          },
        });
      }

      // Create role
      const role = await createRole({
        name,
        permissions,
        description,
      });

      return reply.status(201).send({
        id: role.id,
        name: role.name,
        permissions: parsePermissions(role),
        description: role.description,
        createdAt: role.createdAt.toISOString(),
      });
    }
  );

  /**
   * GET /api/v1/roles/:id
   * Get role by ID
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

      const role = await findRoleById(id);

      if (!role) {
        return reply.status(404).send({
          error: {
            code: "ROLE_NOT_FOUND",
            message: "Role not found",
          },
        });
      }

      return reply.send({
        id: role.id,
        name: role.name,
        permissions: parsePermissions(role),
        description: role.description,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      });
    }
  );

  /**
   * PUT /api/v1/roles/:id
   * Update role
   */
  fastify.put<{ Params: { id: string }; Body: UpdateRoleBody }>(
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
            name: { type: "string", minLength: 1 },
            permissions: {
              type: "array",
              items: { type: "string" },
            },
            description: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, permissions, description } = request.body;

      // Check if role exists
      const existingRole = await findRoleById(id);
      if (!existingRole) {
        return reply.status(404).send({
          error: {
            code: "ROLE_NOT_FOUND",
            message: "Role not found",
          },
        });
      }

      // Prevent modifying Superadmin role
      if (isSuperadminRole(existingRole)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Cannot modify Superadmin role via API. This role can only be managed via direct database access.",
          },
        });
      }

      // Prevent renaming to "Superadmin"
      if (name && name.toLowerCase() === "superadmin") {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Cannot rename role to Superadmin via API.",
          },
        });
      }

      // Prevent adding superadmin permission
      if (permissions && hasSuperadminPermission(permissions)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PERMISSION_PROTECTED",
            message: "Cannot assign superadmin permission via API. This permission can only be assigned via direct database access.",
          },
        });
      }

      // Check if name already taken by another role
      if (name && (await roleNameExists(name, id))) {
        return reply.status(400).send({
          error: {
            code: "ROLE_NAME_EXISTS",
            message: "Role name already exists",
          },
        });
      }

      // Validate permissions if provided
      if (permissions) {
        const invalidPermissions = permissions.filter(
          (p) => !AVAILABLE_PERMISSIONS.includes(p)
        );

        if (invalidPermissions.length > 0) {
          return reply.status(400).send({
            error: {
              code: "INVALID_PERMISSIONS",
              message: `Invalid permissions: ${invalidPermissions.join(", ")}`,
            },
          });
        }
      }

      const role = await updateRole(id, {
        name,
        permissions,
        description,
      });

      return reply.send({
        id: role.id,
        name: role.name,
        permissions: parsePermissions(role),
        description: role.description,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      });
    }
  );

  /**
   * PUT /api/v1/roles/:id/permissions
   * Update role permissions
   */
  fastify.put<{ Params: { id: string }; Body: { permissions: string[] } }>(
    "/:id/permissions",
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
          required: ["permissions"],
          properties: {
            permissions: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { permissions } = request.body;

      // Check if role exists
      const existingRole = await findRoleById(id);
      if (!existingRole) {
        return reply.status(404).send({
          error: {
            code: "ROLE_NOT_FOUND",
            message: "Role not found",
          },
        });
      }

      // Prevent modifying Superadmin role permissions
      if (isSuperadminRole(existingRole)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Cannot modify Superadmin role permissions via API. This role can only be managed via direct database access.",
          },
        });
      }

      // Prevent adding superadmin permission
      if (hasSuperadminPermission(permissions)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PERMISSION_PROTECTED",
            message: "Cannot assign superadmin permission via API. This permission can only be assigned via direct database access.",
          },
        });
      }

      // Validate permissions
      const invalidPermissions = permissions.filter(
        (p) => !AVAILABLE_PERMISSIONS.includes(p)
      );

      if (invalidPermissions.length > 0) {
        return reply.status(400).send({
          error: {
            code: "INVALID_PERMISSIONS",
            message: `Invalid permissions: ${invalidPermissions.join(", ")}`,
          },
        });
      }

      const role = await updateRole(id, { permissions });

      return reply.send({
        id: role.id,
        name: role.name,
        permissions: parsePermissions(role),
        description: role.description,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      });
    }
  );

  /**
   * DELETE /api/v1/roles/:id
   * Delete role
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

      // Check if role exists
      const existingRole = await findRoleById(id);
      if (!existingRole) {
        return reply.status(404).send({
          error: {
            code: "ROLE_NOT_FOUND",
            message: "Role not found",
          },
        });
      }

      // Prevent deleting Superadmin role
      if (isSuperadminRole(existingRole)) {
        return reply.status(403).send({
          error: {
            code: "SUPERADMIN_PROTECTED",
            message: "Cannot delete Superadmin role via API. This role can only be managed via direct database access.",
          },
        });
      }

      // Check if role has users assigned
      if (await roleHasUsers(id)) {
        return reply.status(400).send({
          error: {
            code: "ROLE_HAS_USERS",
            message: "Cannot delete role with assigned users",
          },
        });
      }

      await deleteRole(id);

      return reply.status(204).send();
    }
  );
}
