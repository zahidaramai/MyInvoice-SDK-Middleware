/**
 * Companies repository - handles persistence of company entities
 */

import { getPrismaClient } from "../prisma.js";
import type {
  CreateCompanyInput,
  UpdateCompanyInput,
  UpdateCompanyCredentialsInput,
  CompanyWithUsers,
  ListCompaniesOptions,
  PaginatedResult,
} from "../types.js";
import type { Company } from "@prisma/client";

/**
 * Create a new company
 */
export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const prisma = getPrismaClient();

  return prisma.company.create({
    data: {
      name: input.name,
      tin: input.tin,
      idValue: input.idValue,
      idType: input.idType ?? "BRN",
      address: input.address,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: input.country,
      phone: input.phone,
      email: input.email,
      sstRegistration: input.sstRegistration,
      ttxRegistration: input.ttxRegistration,
      industryCode: input.industryCode,
      industryName: input.industryName,
      myinvoisClientId: input.myinvoisClientId,
      myinvoisClientSecret: input.myinvoisClientSecret,
      myinvoisEnv: input.myinvoisEnv ?? "SANDBOX",
      isActive: input.isActive ?? true,
    },
  });
}

/**
 * Find company by ID
 */
export async function findCompanyById(id: string): Promise<Company | null> {
  const prisma = getPrismaClient();

  return prisma.company.findUnique({
    where: { id },
  });
}

/**
 * Find company by ID with users
 */
export async function findCompanyByIdWithUsers(
  id: string
): Promise<CompanyWithUsers | null> {
  const prisma = getPrismaClient();

  return prisma.company.findUnique({
    where: { id },
    include: {
      users: {
        include: {
          user: {
            include: {
              role: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Find company by TIN and idValue
 */
export async function findCompanyByTinIdValue(
  tin: string,
  idValue: string
): Promise<Company | null> {
  const prisma = getPrismaClient();

  return prisma.company.findUnique({
    where: {
      tin_idValue: {
        tin,
        idValue,
      },
    },
  });
}

/**
 * Update company
 */
export async function updateCompany(
  id: string,
  input: UpdateCompanyInput
): Promise<Company> {
  const prisma = getPrismaClient();

  return prisma.company.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.tin !== undefined && { tin: input.tin }),
      ...(input.idValue !== undefined && { idValue: input.idValue }),
      ...(input.idType !== undefined && { idType: input.idType }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.city !== undefined && { city: input.city }),
      ...(input.state !== undefined && { state: input.state }),
      ...(input.postalCode !== undefined && { postalCode: input.postalCode }),
      ...(input.country !== undefined && { country: input.country }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.sstRegistration !== undefined && { sstRegistration: input.sstRegistration }),
      ...(input.ttxRegistration !== undefined && { ttxRegistration: input.ttxRegistration }),
      ...(input.industryCode !== undefined && { industryCode: input.industryCode }),
      ...(input.industryName !== undefined && { industryName: input.industryName }),
      ...(input.myinvoisEnv !== undefined && { myinvoisEnv: input.myinvoisEnv }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

/**
 * Update company MyInvois credentials
 */
export async function updateCompanyCredentials(
  id: string,
  input: UpdateCompanyCredentialsInput
): Promise<Company> {
  const prisma = getPrismaClient();

  return prisma.company.update({
    where: { id },
    data: {
      myinvoisClientId: input.myinvoisClientId,
      myinvoisClientSecret: input.myinvoisClientSecret,
      ...(input.myinvoisEnv !== undefined && { myinvoisEnv: input.myinvoisEnv }),
    },
  });
}

/**
 * Delete company
 */
export async function deleteCompany(id: string): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.company.delete({
    where: { id },
  });
}

/**
 * List companies with pagination
 */
export async function listCompanies(
  options: ListCompaniesOptions = {}
): Promise<PaginatedResult<Company>> {
  const prisma = getPrismaClient();
  const { page = 1, limit = 20, search, isActive } = options;
  const skip = (page - 1) * limit;

  const where = {
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { tin: { contains: search, mode: "insensitive" as const } },
        { idValue: { contains: search, mode: "insensitive" as const } },
      ],
    }),
    ...(isActive !== undefined && { isActive }),
  };

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.company.count({ where }),
  ]);

  return {
    data: companies,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * List companies for a user
 */
export async function listCompaniesForUser(userId: string): Promise<Company[]> {
  const prisma = getPrismaClient();

  const userCompanies = await prisma.userCompany.findMany({
    where: { userId },
    include: {
      company: true,
    },
  });

  return userCompanies.map((uc) => uc.company);
}

/**
 * Check if company exists
 */
export async function companyExists(id: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.company.count({
    where: { id },
  });

  return count > 0;
}

/**
 * Check if TIN/idValue combination exists
 */
export async function tinIdValueExists(
  tin: string,
  idValue: string,
  excludeCompanyId?: string
): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.company.count({
    where: {
      tin,
      idValue,
      ...(excludeCompanyId && { id: { not: excludeCompanyId } }),
    },
  });

  return count > 0;
}

/**
 * Check if user is linked to company
 */
export async function isUserLinkedToCompany(
  userId: string,
  companyId: string
): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.userCompany.count({
    where: {
      userId,
      companyId,
    },
  });

  return count > 0;
}

/**
 * Get all companies (without pagination, for dropdowns)
 */
export async function getAllCompanies(activeOnly = true): Promise<Company[]> {
  const prisma = getPrismaClient();

  return prisma.company.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: { name: "asc" },
  });
}
