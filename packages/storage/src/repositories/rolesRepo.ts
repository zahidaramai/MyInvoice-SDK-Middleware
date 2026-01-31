/**
 * Roles repository - handles persistence of roles and permissions
 */

import { getPrismaClient } from "../prisma.js";
import type {
  CreateRoleInput,
  UpdateRoleInput,
  RoleWithUserCount,
  ListRolesOptions,
  PaginatedResult,
} from "../types.js";
import type { Role } from "@prisma/client";

/**
 * Create a new role
 */
export async function createRole(input: CreateRoleInput): Promise<Role> {
  const prisma = getPrismaClient();

  return prisma.role.create({
    data: {
      name: input.name,
      permissions: JSON.stringify(input.permissions),
      description: input.description,
    },
  });
}

/**
 * Find role by ID
 */
export async function findRoleById(id: string): Promise<Role | null> {
  const prisma = getPrismaClient();

  return prisma.role.findUnique({
    where: { id },
  });
}

/**
 * Find role by name
 */
export async function findRoleByName(name: string): Promise<Role | null> {
  const prisma = getPrismaClient();

  return prisma.role.findUnique({
    where: { name },
  });
}

/**
 * Update role
 */
export async function updateRole(id: string, input: UpdateRoleInput): Promise<Role> {
  const prisma = getPrismaClient();

  return prisma.role.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.permissions !== undefined && {
        permissions: JSON.stringify(input.permissions),
      }),
      ...(input.description !== undefined && { description: input.description }),
    },
  });
}

/**
 * Delete role
 */
export async function deleteRole(id: string): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.role.delete({
    where: { id },
  });
}

/**
 * List roles with pagination
 */
export async function listRoles(
  options: ListRolesOptions = {}
): Promise<PaginatedResult<RoleWithUserCount>> {
  const prisma = getPrismaClient();
  const { page = 1, limit = 20, search } = options;
  const skip = (page - 1) * limit;

  const where = {
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { description: { contains: search, mode: "insensitive" as const } },
      ],
    }),
  };

  const [roles, total] = await Promise.all([
    prisma.role.findMany({
      where,
      include: {
        _count: {
          select: { users: true },
        },
      },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.role.count({ where }),
  ]);

  // Transform to include userCount
  const rolesWithCount = roles.map((role) => ({
    ...role,
    userCount: role._count.users,
  }));

  return {
    data: rolesWithCount,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Check if role exists
 */
export async function roleExists(id: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.role.count({
    where: { id },
  });

  return count > 0;
}

/**
 * Check if role name is taken
 */
export async function roleNameExists(name: string, excludeRoleId?: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.role.count({
    where: {
      name,
      ...(excludeRoleId && { id: { not: excludeRoleId } }),
    },
  });

  return count > 0;
}

/**
 * Check if role has users assigned
 */
export async function roleHasUsers(id: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.user.count({
    where: { roleId: id },
  });

  return count > 0;
}

/**
 * Get all roles (without pagination, for dropdowns)
 */
export async function getAllRoles(): Promise<Role[]> {
  const prisma = getPrismaClient();

  return prisma.role.findMany({
    orderBy: { name: "asc" },
  });
}

/**
 * Parse permissions from role
 */
export function parsePermissions(role: Role): string[] {
  try {
    return JSON.parse(role.permissions);
  } catch {
    return [];
  }
}
