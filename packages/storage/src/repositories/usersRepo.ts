/**
 * Users repository - handles persistence of user accounts
 */

import { getPrismaClient } from "../prisma.js";
import type {
  CreateUserInput,
  UpdateUserInput,
  UserWithRole,
  UserWithRoleAndCompanies,
  ListUsersOptions,
  PaginatedResult,
} from "../types.js";

/**
 * Create a new user
 */
export async function createUser(input: CreateUserInput): Promise<UserWithRole> {
  const prisma = getPrismaClient();

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      roleId: input.roleId,
      isActive: input.isActive ?? true,
    },
    include: {
      role: true,
    },
  });

  return user;
}

/**
 * Find user by ID
 */
export async function findUserById(id: string): Promise<UserWithRole | null> {
  const prisma = getPrismaClient();

  return prisma.user.findUnique({
    where: { id },
    include: {
      role: true,
    },
  });
}

/**
 * Find user by ID with companies
 */
export async function findUserByIdWithCompanies(
  id: string
): Promise<UserWithRoleAndCompanies | null> {
  const prisma = getPrismaClient();

  return prisma.user.findUnique({
    where: { id },
    include: {
      role: true,
      companies: {
        include: {
          company: true,
        },
      },
    },
  });
}

/**
 * Find user by email
 */
export async function findUserByEmail(email: string): Promise<UserWithRole | null> {
  const prisma = getPrismaClient();

  return prisma.user.findUnique({
    where: { email },
    include: {
      role: true,
    },
  });
}

/**
 * Find user by email with companies
 */
export async function findUserByEmailWithCompanies(
  email: string
): Promise<UserWithRoleAndCompanies | null> {
  const prisma = getPrismaClient();

  return prisma.user.findUnique({
    where: { email },
    include: {
      role: true,
      companies: {
        include: {
          company: true,
        },
      },
    },
  });
}

/**
 * Update user
 */
export async function updateUser(
  id: string,
  input: UpdateUserInput
): Promise<UserWithRole> {
  const prisma = getPrismaClient();

  return prisma.user.update({
    where: { id },
    data: {
      ...(input.email !== undefined && { email: input.email }),
      ...(input.passwordHash !== undefined && { passwordHash: input.passwordHash }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.roleId !== undefined && { roleId: input.roleId }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
    include: {
      role: true,
    },
  });
}

/**
 * Delete user
 */
export async function deleteUser(id: string): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.user.delete({
    where: { id },
  });
}

/**
 * List users with pagination
 */
export async function listUsers(
  options: ListUsersOptions = {}
): Promise<PaginatedResult<UserWithRole>> {
  const prisma = getPrismaClient();
  const { page = 1, limit = 20, search, roleId, isActive } = options;
  const skip = (page - 1) * limit;

  const where = {
    ...(search && {
      OR: [
        { email: { contains: search, mode: "insensitive" as const } },
        { name: { contains: search, mode: "insensitive" as const } },
      ],
    }),
    ...(roleId && { roleId }),
    ...(isActive !== undefined && { isActive }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        role: true,
      },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data: users,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Link user to company
 */
export async function linkUserToCompany(
  userId: string,
  companyId: string
): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.userCompany.create({
    data: {
      userId,
      companyId,
    },
  });
}

/**
 * Unlink user from company
 */
export async function unlinkUserFromCompany(
  userId: string,
  companyId: string
): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.userCompany.delete({
    where: {
      userId_companyId: {
        userId,
        companyId,
      },
    },
  });
}

/**
 * Check if user exists
 */
export async function userExists(id: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.user.count({
    where: { id },
  });

  return count > 0;
}

/**
 * Check if email is taken
 */
export async function emailExists(email: string, excludeUserId?: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.user.count({
    where: {
      email,
      ...(excludeUserId && { id: { not: excludeUserId } }),
    },
  });

  return count > 0;
}
