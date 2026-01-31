/**
 * Company Management API routes
 */

import type { FastifyInstance } from "fastify";
import {
  createCompany,
  findCompanyById,
  findCompanyByIdWithUsers,
  updateCompany,
  updateCompanyCredentials,
  listCompanies,
  companyExists,
  tinIdValueExists,
  getAllCompanies,
  userExists,
  isUserLinkedToCompany,
  linkUserToCompany,
  unlinkUserFromCompany,
  getPrismaClient,
} from "@myinvois/storage";
import { authenticate, requirePermission, isSuperadmin } from "../auth/middleware.js";
import { findUserByIdWithCompanies } from "@myinvois/storage";

/**
 * Normalize phone number to MyInvois format (+60XXXXXXXXX)
 * Removes dashes, spaces, and adds country code if missing
 */
function normalizePhoneNumber(phone: string | undefined | null): string | undefined {
  if (!phone || phone.trim() === "") {
    return undefined;
  }

  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, "");

  // If starts with +, keep it
  if (cleaned.startsWith("+")) {
    cleaned = "+" + cleaned.slice(1).replace(/\+/g, "");
  } else {
    cleaned = cleaned.replace(/\+/g, "");
  }

  // Handle different formats
  if (cleaned.startsWith("+60")) {
    return cleaned;
  } else if (cleaned.startsWith("60")) {
    return "+" + cleaned;
  } else if (cleaned.startsWith("0")) {
    // Malaysian format starting with 0 (e.g., 03, 012)
    return "+60" + cleaned.slice(1);
  } else if (cleaned.length >= 8) {
    return "+60" + cleaned;
  }

  // Return original if can't normalize
  return phone;
}

/**
 * Create company request body
 */
interface CreateCompanyBody {
  name: string;
  tin: string;
  idValue: string;
  idType?: "BRN" | "NRIC" | "PASSPORT" | "ARMY";
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  sstRegistration?: string;
  ttxRegistration?: string;
  industryCode?: string;
  industryName?: string;
  myinvoisClientId?: string;
  myinvoisClientSecret?: string;
  myinvoisEnv?: "SANDBOX" | "PROD";
  isActive?: boolean;
}

/**
 * Legacy create company request body (client's original format)
 * Accepts both PascalCase and camelCase field names
 */
interface LegacyCreateCompanyBody {
  // Our format
  name?: string;
  tin?: string;
  idValue?: string;
  idType?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  industryCode?: string;
  industryName?: string;
  myinvoisClientId?: string;
  myinvoisClientSecret?: string;
  myinvoisEnv?: string;
  // Client's original format
  companyName?: string;  // → name
  brn?: string;         // → idValue (with idType=BRN)
  address1?: string;    // → address
  stateCode?: string;   // → state
  telephone?: string;   // → phone
  industry1?: string;   // → industryCode (MSIC code e.g., "66191")
  industryCode1?: string; // → industryName (e.g., "Wholesales and Retail")
}

/**
 * Update company request body
 * Accepts both our format and client's original format
 */
interface UpdateCompanyBody {
  // Our format
  name?: string;
  tin?: string;
  idValue?: string;
  idType?: "BRN" | "NRIC" | "PASSPORT" | "ARMY";
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  sstRegistration?: string;
  ttxRegistration?: string;
  industryCode?: string;
  industryName?: string;
  myinvoisEnv?: "SANDBOX" | "PROD";
  isActive?: boolean;
  // Client's original format aliases
  companyName?: string;    // → name
  brn?: string;           // → idValue (with idType=BRN)
  address1?: string;      // → address
  stateCode?: string;     // → state
  telephone?: string;     // → phone
  industry1?: string;     // → industryCode
  industryCode1?: string; // → industryName
  sst?: string;           // → sstRegistration
}

/**
 * Update credentials request body
 */
interface UpdateCredentialsBody {
  myinvoisClientId: string;
  myinvoisClientSecret: string;
  myinvoisEnv?: "SANDBOX" | "PROD";
}

/**
 * List companies query params
 */
interface ListCompaniesQuery {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: string;
}

/**
 * Register company management routes
 */
export async function companiesRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply authentication to all routes
  fastify.addHook("preHandler", authenticate);
  // Note: manage:companies permission is applied per-route to write operations only.
  // GET routes are accessible to any authenticated user (they only see their assigned companies).

  /**
   * GET /api/v1/companies
   * List companies with pagination
   * Superadmin sees all companies, regular users only see their assigned companies
   */
  fastify.get<{ Querystring: ListCompaniesQuery }>(
    "/",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            page: { type: "number", minimum: 1 },
            limit: { type: "number", minimum: 1, maximum: 100 },
            search: { type: "string" },
            isActive: { type: "string", enum: ["true", "false"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { page, limit, search, isActive } = request.query;

      // Check if user is superadmin
      if (isSuperadmin(request.user)) {
        // Superadmin sees all companies
        const result = await listCompanies({
          page: page || 1,
          limit: limit || 20,
          search,
          isActive: isActive ? isActive === "true" : undefined,
        });

        return reply.send({
          data: result.data.map((company) => ({
            id: company.id,
            name: company.name,
            tin: company.tin,
            idValue: company.idValue,
            idType: company.idType,
            address: company.address,
            city: company.city,
            state: company.state,
            postalCode: company.postalCode,
            country: company.country,
            phone: company.phone,
            email: company.email,
            industryCode: company.industryCode,
            industryName: company.industryName,
            sstRegistration: company.sstRegistration,
            ttxRegistration: company.ttxRegistration,
            myinvoisEnv: company.myinvoisEnv,
            hasCredentials: !!(company.myinvoisClientId && company.myinvoisClientSecret),
            isActive: company.isActive,
            createdAt: company.createdAt.toISOString(),
            updatedAt: company.updatedAt.toISOString(),
          })),
          pagination: {
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
          },
        });
      }

      // P2-11: Use database-level filtering instead of in-memory filtering
      const prisma = getPrismaClient();
      const pageNum = page || 1;
      const limitNum = limit || 20;
      const skip = (pageNum - 1) * limitNum;

      // Build where clause with filters applied at database level
      const whereClause: {
        users: { some: { userId: string } };
        isActive?: boolean;
        OR?: Array<{ name: { contains: string; mode: "insensitive" } } | { tin: { contains: string; mode: "insensitive" } } | { idValue: { contains: string; mode: "insensitive" } }>;
      } = {
        users: { some: { userId: request.user!.userId } },
      };

      // Apply isActive filter at database level
      if (isActive !== undefined) {
        whereClause.isActive = isActive === "true";
      }

      // Apply search filter at database level
      if (search) {
        whereClause.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { tin: { contains: search, mode: "insensitive" } },
          { idValue: { contains: search, mode: "insensitive" } },
        ];
      }

      // Get total count and paginated data in parallel
      const [total, paginatedCompanies] = await Promise.all([
        prisma.company.count({ where: whereClause }),
        prisma.company.findMany({
          where: whereClause,
          skip,
          take: limitNum,
          orderBy: { name: "asc" },
        }),
      ]);

      return reply.send({
        data: paginatedCompanies.map((company) => ({
          id: company.id,
          name: company.name,
          tin: company.tin,
          idValue: company.idValue,
          idType: company.idType,
          address: company.address,
          city: company.city,
          state: company.state,
          postalCode: company.postalCode,
          country: company.country,
          phone: company.phone,
          email: company.email,
          industryCode: company.industryCode,
          industryName: company.industryName,
          sstRegistration: company.sstRegistration,
          ttxRegistration: company.ttxRegistration,
          myinvoisEnv: company.myinvoisEnv,
          hasCredentials: !!(company.myinvoisClientId && company.myinvoisClientSecret),
          isActive: company.isActive,
          createdAt: company.createdAt.toISOString(),
          updatedAt: company.updatedAt.toISOString(),
        })),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    }
  );

  /**
   * GET /api/v1/companies/all
   * Get all active companies (for dropdowns)
   * Superadmin sees all companies, regular users only see their assigned companies
   */
  fastify.get("/all", async (request, reply) => {
    // Superadmin sees all companies
    if (isSuperadmin(request.user)) {
      const companies = await getAllCompanies(true);
      return reply.send({
        data: companies.map((company) => ({
          id: company.id,
          name: company.name,
          tin: company.tin,
          idValue: company.idValue,
        })),
      });
    }

    // Regular users only see their assigned companies
    const userWithCompanies = await findUserByIdWithCompanies(request.user!.userId);
    if (!userWithCompanies) {
      return reply.send({ data: [] });
    }

    const activeCompanies = userWithCompanies.companies
      .map((uc) => uc.company)
      .filter((c) => c.isActive);

    return reply.send({
      data: activeCompanies.map((company) => ({
        id: company.id,
        name: company.name,
        tin: company.tin,
        idValue: company.idValue,
      })),
    });
  });

  /**
   * POST /api/v1/companies
   * Create a new company
   * Accepts both our format (name) and client's original format (companyName)
   */
  fastify.post<{ Body: CreateCompanyBody & LegacyCreateCompanyBody }>(
    "/",
    {
      preHandler: [requirePermission("manage:companies")],
      schema: {
        body: {
          type: "object",
          properties: {
            // Our format
            name: { type: "string", minLength: 1 },
            tin: { type: "string", minLength: 1 },
            idValue: { type: "string" },
            idType: { type: "string", enum: ["BRN", "NRIC", "PASSPORT", "ARMY"] },
            address: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            postalCode: { type: "string" },
            country: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
            sstRegistration: { type: "string" },
            ttxRegistration: { type: "string" },
            industryCode: { type: "string" },
            industryName: { type: "string" },
            myinvoisClientId: { type: "string" },
            myinvoisClientSecret: { type: "string" },
            myinvoisEnv: { type: "string", enum: ["SANDBOX", "PROD"] },
            isActive: { type: "boolean" },
            // Client's original format aliases
            companyName: { type: "string" },
            brn: { type: "string" },
            address1: { type: "string" },
            stateCode: { type: "string" },
            telephone: { type: "string" },
            industry1: { type: "string" },
            industryCode1: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      // Normalize fields - support both our format and client's original format
      const name = body.name || body.companyName;
      const tin = body.tin;
      const idValue = body.idValue || body.brn;
      const idType = body.idType || (body.brn ? "BRN" : undefined);
      const address = body.address || body.address1;
      const city = body.city;
      const state = body.state || body.stateCode;
      const postalCode = body.postalCode;
      const country = body.country;
      const phone = normalizePhoneNumber(body.phone || body.telephone);
      const email = body.email;
      const sstRegistration = body.sstRegistration;
      const ttxRegistration = body.ttxRegistration;
      // Client's format: industry1 = MSIC code, industryCode1 = name
      const industryCode = body.industryCode || body.industry1;
      const industryName = body.industryName || body.industryCode1;
      const myinvoisClientId = body.myinvoisClientId;
      const myinvoisClientSecret = body.myinvoisClientSecret;
      const myinvoisEnv = body.myinvoisEnv;
      const isActive = body.isActive;

      // Validate required fields
      if (!name) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Company name is required (name or companyName)",
          },
        });
      }
      if (!tin) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "TIN is required",
          },
        });
      }
      // Check if TIN already exists (idValue/BRN is optional)
      if (await tinIdValueExists(tin, idValue || "")) {
        return reply.status(400).send({
          error: {
            code: "COMPANY_EXISTS",
            message: "Company with this TIN and ID value already exists",
          },
        });
      }

      // Create company
      const company = await createCompany({
        name,
        tin,
        idValue: idValue || "",
        idType,
        address,
        city,
        state,
        postalCode,
        country,
        phone,
        email,
        sstRegistration,
        ttxRegistration,
        industryCode,
        industryName,
        myinvoisClientId,
        myinvoisClientSecret,
        myinvoisEnv,
        isActive,
      });

      return reply.status(201).send({
        id: company.id,
        name: company.name,
        tin: company.tin,
        idValue: company.idValue,
        idType: company.idType,
        address: company.address,
        city: company.city,
        state: company.state,
        postalCode: company.postalCode,
        country: company.country,
        phone: company.phone,
        email: company.email,
        industryCode: company.industryCode,
        industryName: company.industryName,
        sstRegistration: company.sstRegistration,
        ttxRegistration: company.ttxRegistration,
        myinvoisEnv: company.myinvoisEnv,
        hasCredentials: !!(company.myinvoisClientId && company.myinvoisClientSecret),
        isActive: company.isActive,
        createdAt: company.createdAt.toISOString(),
      });
    }
  );

  /**
   * POST /api/v1/companies/create
   * Alias endpoint for client's original Postman format
   * Accepts both our format and client's original format
   */
  fastify.post<{ Body: LegacyCreateCompanyBody }>(
    "/create",
    {
      preHandler: [requirePermission("manage:companies")],
      schema: {
        body: {
          type: "object",
          properties: {
            // Our format
            name: { type: "string" },
            tin: { type: "string" },
            idValue: { type: "string" },
            idType: { type: "string" },
            address: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            postalCode: { type: "string" },
            country: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
            industryCode: { type: "string" },
            industryName: { type: "string" },
            myinvoisClientId: { type: "string" },
            myinvoisClientSecret: { type: "string" },
            myinvoisEnv: { type: "string", enum: ["SANDBOX", "PROD"] },
            // Client's original format
            companyName: { type: "string" },
            brn: { type: "string" },
            address1: { type: "string" },
            stateCode: { type: "string" },
            telephone: { type: "string" },
            industry1: { type: "string" },
            industryCode1: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      // Normalize fields from client's original format to our format
      const name = body.name || body.companyName;
      const tin = body.tin;
      const idValue = body.idValue || body.brn;
      const idType = body.idType || (body.brn ? "BRN" : undefined);
      const address = body.address || body.address1;
      const city = body.city;
      const state = body.state || body.stateCode;
      const postalCode = body.postalCode;
      const country = body.country;
      const phone = normalizePhoneNumber(body.phone || body.telephone);
      const email = body.email;
      // Client's format: industry1 = MSIC code (e.g., "66191"), industryCode1 = name (e.g., "Wholesales and Retail")
      const industryCode = body.industryCode || body.industry1;
      const industryName = body.industryName || body.industryCode1;
      const myinvoisClientId = body.myinvoisClientId;
      const myinvoisClientSecret = body.myinvoisClientSecret;
      const myinvoisEnv = body.myinvoisEnv as "SANDBOX" | "PROD" | undefined;

      // Validate required fields
      if (!name) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Company name is required (name or companyName)",
          },
        });
      }
      if (!tin) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "TIN is required",
          },
        });
      }
      // Check if TIN already exists (idValue/BRN is optional)
      if (await tinIdValueExists(tin, idValue || "")) {
        return reply.status(400).send({
          error: {
            code: "COMPANY_EXISTS",
            message: "Company with this TIN and ID value already exists",
          },
        });
      }

      // Create company
      const company = await createCompany({
        name,
        tin,
        idValue: idValue || "",
        idType: idType as "BRN" | "NRIC" | "PASSPORT" | "ARMY" | undefined,
        address,
        city,
        state,
        postalCode,
        country,
        phone,
        email,
        industryCode,
        industryName,
        myinvoisClientId,
        myinvoisClientSecret,
        myinvoisEnv,
        isActive: true,
      });

      return reply.status(201).send({
        id: company.id,
        name: company.name,
        tin: company.tin,
        idValue: company.idValue,
        idType: company.idType,
        address: company.address,
        city: company.city,
        state: company.state,
        postalCode: company.postalCode,
        country: company.country,
        phone: company.phone,
        email: company.email,
        industryCode: company.industryCode,
        industryName: company.industryName,
        sstRegistration: company.sstRegistration,
        ttxRegistration: company.ttxRegistration,
        myinvoisEnv: company.myinvoisEnv,
        hasCredentials: !!(company.myinvoisClientId && company.myinvoisClientSecret),
        isActive: company.isActive,
        createdAt: company.createdAt.toISOString(),
      });
    }
  );

  /**
   * GET /api/v1/companies/:id
   * Get company by ID
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

      const company = await findCompanyByIdWithUsers(id);

      if (!company) {
        return reply.status(404).send({
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        });
      }

      return reply.send({
        id: company.id,
        name: company.name,
        tin: company.tin,
        idValue: company.idValue,
        idType: company.idType,
        address: company.address,
        city: company.city,
        state: company.state,
        postalCode: company.postalCode,
        country: company.country,
        phone: company.phone,
        email: company.email,
        industryCode: company.industryCode,
        industryName: company.industryName,
        sstRegistration: company.sstRegistration,
        ttxRegistration: company.ttxRegistration,
        myinvoisEnv: company.myinvoisEnv,
        hasCredentials: !!(company.myinvoisClientId && company.myinvoisClientSecret),
        users: company.users.map((uc) => ({
          id: uc.user.id,
          email: uc.user.email,
          name: uc.user.name,
          role: uc.user.role.name,
        })),
        isActive: company.isActive,
        createdAt: company.createdAt.toISOString(),
        updatedAt: company.updatedAt.toISOString(),
      });
    }
  );

  /**
   * PUT /api/v1/companies/:id
   * Update company
   * Accepts both our format and client's original format
   */
  fastify.put<{ Params: { id: string }; Body: UpdateCompanyBody }>(
    "/:id",
    {
      preHandler: [requirePermission("manage:companies")],
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
            // Our format
            name: { type: "string", minLength: 1 },
            tin: { type: "string", minLength: 1 },
            idValue: { type: "string" },
            idType: { type: "string", enum: ["BRN", "NRIC", "PASSPORT", "ARMY"] },
            address: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            postalCode: { type: "string" },
            country: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
            sstRegistration: { type: "string" },
            ttxRegistration: { type: "string" },
            industryCode: { type: "string" },
            industryName: { type: "string" },
            myinvoisEnv: { type: "string", enum: ["SANDBOX", "PROD"] },
            isActive: { type: "boolean" },
            // Client's original format aliases
            companyName: { type: "string" },
            brn: { type: "string" },
            address1: { type: "string" },
            stateCode: { type: "string" },
            telephone: { type: "string" },
            industry1: { type: "string" },
            industryCode1: { type: "string" },
            sst: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;

      // Normalize fields - support both our format and client's original format
      const name = body.name || body.companyName;
      const tin = body.tin;
      const idValue = body.idValue || body.brn;
      const idType = body.idType || (body.brn ? "BRN" : undefined);
      const address = body.address || body.address1;
      const city = body.city;
      const state = body.state || body.stateCode;
      const postalCode = body.postalCode;
      const country = body.country;
      const phone = normalizePhoneNumber(body.phone || body.telephone);
      const email = body.email;
      const sstRegistration = body.sstRegistration || body.sst || undefined;
      const ttxRegistration = body.ttxRegistration;
      // Client's format: industry1 = MSIC code, industryCode1 = name
      const industryCode = body.industryCode || body.industry1;
      const industryName = body.industryName || body.industryCode1;
      const myinvoisEnv = body.myinvoisEnv;
      const isActive = body.isActive;

      // Check if company exists
      const existing = await findCompanyById(id);

      if (!existing) {
        return reply.status(404).send({
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        });
      }

      // Check if new TIN/idValue combination conflicts with another company
      const newTin = tin ?? existing.tin;
      const newIdValue = idValue ?? existing.idValue;

      if (
        (tin || idValue) &&
        (await tinIdValueExists(newTin, newIdValue, id))
      ) {
        return reply.status(400).send({
          error: {
            code: "COMPANY_EXISTS",
            message: "Company with this TIN and ID value already exists",
          },
        });
      }

      const company = await updateCompany(id, {
        name,
        tin,
        idValue,
        idType,
        address,
        city,
        state,
        postalCode,
        country,
        phone,
        email,
        sstRegistration,
        ttxRegistration,
        industryCode,
        industryName,
        myinvoisEnv,
        isActive,
      });

      return reply.send({
        id: company.id,
        name: company.name,
        tin: company.tin,
        idValue: company.idValue,
        idType: company.idType,
        address: company.address,
        city: company.city,
        state: company.state,
        postalCode: company.postalCode,
        country: company.country,
        phone: company.phone,
        email: company.email,
        industryCode: company.industryCode,
        industryName: company.industryName,
        sstRegistration: company.sstRegistration,
        ttxRegistration: company.ttxRegistration,
        myinvoisEnv: company.myinvoisEnv,
        hasCredentials: !!(company.myinvoisClientId && company.myinvoisClientSecret),
        isActive: company.isActive,
        createdAt: company.createdAt.toISOString(),
        updatedAt: company.updatedAt.toISOString(),
      });
    }
  );

  /**
   * PUT /api/v1/companies/:id/credentials
   * Update company MyInvois credentials
   */
  fastify.put<{ Params: { id: string }; Body: UpdateCredentialsBody }>(
    "/:id/credentials",
    {
      preHandler: [requirePermission("manage:companies")],
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
          required: ["myinvoisClientId", "myinvoisClientSecret"],
          properties: {
            myinvoisClientId: { type: "string", minLength: 1 },
            myinvoisClientSecret: { type: "string", minLength: 1 },
            myinvoisEnv: { type: "string", enum: ["SANDBOX", "PROD"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { myinvoisClientId, myinvoisClientSecret, myinvoisEnv } = request.body;

      if (!(await companyExists(id))) {
        return reply.status(404).send({
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        });
      }

      // TODO: Encrypt credentials before storing
      // For now, storing as plain text (implement encryption in production)
      const company = await updateCompanyCredentials(id, {
        myinvoisClientId,
        myinvoisClientSecret,
        myinvoisEnv,
      });

      return reply.send({
        id: company.id,
        name: company.name,
        myinvoisEnv: company.myinvoisEnv,
        hasCredentials: true,
        message: "Credentials updated successfully",
      });
    }
  );

  /**
   * POST /api/v1/companies/:id/users/:userId
   * Link user to company
   */
  fastify.post<{ Params: { id: string; userId: string } }>(
    "/:id/users/:userId",
    {
      preHandler: [requirePermission("manage:companies")],
      schema: {
        params: {
          type: "object",
          required: ["id", "userId"],
          properties: {
            id: { type: "string" },
            userId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id, userId } = request.params;

      if (!(await companyExists(id))) {
        return reply.status(404).send({
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        });
      }

      if (!(await userExists(userId))) {
        return reply.status(404).send({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      if (await isUserLinkedToCompany(userId, id)) {
        return reply.status(400).send({
          error: {
            code: "ALREADY_LINKED",
            message: "User already linked to company",
          },
        });
      }

      await linkUserToCompany(userId, id);

      return reply.status(201).send({
        message: "User linked to company successfully",
      });
    }
  );

  /**
   * DELETE /api/v1/companies/:id/users/:userId
   * Unlink user from company
   */
  fastify.delete<{ Params: { id: string; userId: string } }>(
    "/:id/users/:userId",
    {
      preHandler: [requirePermission("manage:companies")],
      schema: {
        params: {
          type: "object",
          required: ["id", "userId"],
          properties: {
            id: { type: "string" },
            userId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id, userId } = request.params;

      if (!(await isUserLinkedToCompany(userId, id))) {
        return reply.status(404).send({
          error: {
            code: "NOT_LINKED",
            message: "User is not linked to this company",
          },
        });
      }

      await unlinkUserFromCompany(userId, id);

      return reply.status(204).send();
    }
  );

  /**
   * DELETE /api/v1/companies/:id
   * Soft-delete company (set isActive: false)
   * Company and its invoices remain in database but hidden from UI
   */
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    {
      preHandler: [requirePermission("manage:companies")],
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

      if (!(await companyExists(id))) {
        return reply.status(404).send({
          error: {
            code: "COMPANY_NOT_FOUND",
            message: "Company not found",
          },
        });
      }

      // Soft-delete: set isActive to false
      // Company and its invoices remain in database but hidden from UI
      await updateCompany(id, { isActive: false });

      return reply.status(204).send();
    }
  );
}
