/**
 * TST-04: Company Management API Tests
 * Tests for companies CRUD endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import * as storage from "@myinvois/storage";

// Mock storage functions
vi.mock("@myinvois/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@myinvois/storage")>();
  return {
    ...original,
    createCompany: vi.fn(),
    findCompanyById: vi.fn(),
    findCompanyByIdWithUsers: vi.fn(),
    updateCompany: vi.fn(),
    updateCompanyCredentials: vi.fn(),
    listCompanies: vi.fn(),
    getAllCompanies: vi.fn(),
    companyExists: vi.fn(),
    tinIdValueExists: vi.fn(),
    userExists: vi.fn(),
    isUserLinkedToCompany: vi.fn(),
    linkUserToCompany: vi.fn(),
    unlinkUserFromCompany: vi.fn(),
    findUserByIdWithCompanies: vi.fn(),
    parsePermissions: vi.fn().mockReturnValue(["manage:companies", "read:documents"]),
    getPrismaClient: vi.fn().mockReturnValue({
      company: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
      },
    }),
  };
});

// Mock poll queue
vi.mock("../src/lib/pollQueue.js", () => ({
  POLL_QUEUE_NAME: "poll-submission",
  MIN_POLL_INTERVAL_MS: 3000,
  enqueuePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
  enqueueImmediatePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
  calculatePollDelay: vi.fn().mockReturnValue(3000),
  closePollQueue: vi.fn().mockResolvedValue(undefined),
  getPollQueueStats: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
}));

// Mock JWT functions
vi.mock("../src/auth/jwt.js", () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token === "valid-admin-token") {
      return {
        userId: "admin-user-123",
        email: "admin@example.com",
        companyId: "company-123",
        permissions: ["manage:companies", "read:documents"],
        type: "access",
      };
    }
    if (token === "superadmin-token") {
      return {
        userId: "superadmin-123",
        email: "superadmin@example.com",
        companyId: "company-123",
        permissions: ["*"],
        type: "access",
      };
    }
    throw new Error("Invalid token");
  }),
  verifyPosToken: vi.fn(() => {
    throw new Error("Not a POS token");
  }),
  verifyRefreshToken: vi.fn(),
  createTokenPair: vi.fn(),
  createAccessToken: vi.fn(),
  hashRefreshToken: vi.fn(),
}));

// Sample test data
const mockCompany = {
  id: "company-123",
  name: "Test Company",
  tin: "C12345678901",
  idValue: "BRN123456",
  idType: "BRN",
  address: "123 Test St",
  city: "Test City",
  state: "14",
  postalCode: "12345",
  country: "MYS",
  phone: "0123456789",
  email: "test@company.com",
  industryCode: "62010",
  industryName: "IT Services",
  sstRegistration: null,
  ttxRegistration: null,
  myinvoisClientId: "client-id",
  myinvoisClientSecret: "client-secret",
  myinvoisEnv: "SANDBOX",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCompanyWithUsers = {
  ...mockCompany,
  users: [
    {
      user: {
        id: "user-123",
        email: "user@example.com",
        name: "Test User",
        role: { name: "Admin" },
      },
    },
  ],
};

const mockCompanyList = {
  data: [mockCompany],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const VALID_ADMIN_TOKEN = "valid-admin-token";
const SUPERADMIN_TOKEN = "superadmin-token";

describe("TST-04: Company Management API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/v1/companies", () => {
    it("should list companies with pagination for superadmin", async () => {
      vi.mocked(storage.listCompanies).mockResolvedValue(mockCompanyList as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/companies",
        headers: {
          authorization: `Bearer ${SUPERADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe("Test Company");
      expect(body.pagination.total).toBe(1);
    });

    it("should list only assigned companies for regular users", async () => {
      const mockPrisma = storage.getPrismaClient();
      vi.mocked(mockPrisma.company.findMany).mockResolvedValue([mockCompany] as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/companies",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should return 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/companies",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/v1/companies/all", () => {
    it("should return all companies for superadmin", async () => {
      vi.mocked(storage.getAllCompanies).mockResolvedValue([mockCompany] as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/companies/all",
        headers: {
          authorization: `Bearer ${SUPERADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.length).toBe(1);
    });

    it("should return only assigned companies for regular users", async () => {
      vi.mocked(storage.findUserByIdWithCompanies).mockResolvedValue({
        id: "admin-user-123",
        companies: [{ company: { ...mockCompany, isActive: true } }],
      } as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/companies/all",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeDefined();
    });
  });

  describe("GET /api/v1/companies/:id", () => {
    it("should return company by ID", async () => {
      vi.mocked(storage.findCompanyByIdWithUsers).mockResolvedValue(mockCompanyWithUsers as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/companies/company-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe("company-123");
      expect(body.name).toBe("Test Company");
      expect(body.users).toBeDefined();
    });

    it("should return 404 for non-existent company", async () => {
      vi.mocked(storage.findCompanyByIdWithUsers).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/companies/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("COMPANY_NOT_FOUND");
    });
  });

  describe("POST /api/v1/companies", () => {
    it("should create a new company", async () => {
      vi.mocked(storage.tinIdValueExists).mockResolvedValue(false);
      vi.mocked(storage.createCompany).mockResolvedValue(mockCompany as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Test Company",
          tin: "C12345678901",
          idValue: "BRN123456",
          idType: "BRN",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe("Test Company");
    });

    it("should accept client's original format (companyName)", async () => {
      vi.mocked(storage.tinIdValueExists).mockResolvedValue(false);
      vi.mocked(storage.createCompany).mockResolvedValue(mockCompany as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          companyName: "Test Company",
          tin: "C12345678901",
          brn: "BRN123456",
          address1: "123 Test St",
          stateCode: "14",
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it("should return 400 for duplicate TIN/idValue", async () => {
      vi.mocked(storage.tinIdValueExists).mockResolvedValue(true);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Test Company",
          tin: "C12345678901",
          idValue: "BRN123456",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("COMPANY_EXISTS");
    });

    it("should return 400 for missing name", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          tin: "C12345678901",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 400 for missing TIN", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Test Company",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /api/v1/companies/create", () => {
    it("should create company using legacy endpoint", async () => {
      vi.mocked(storage.tinIdValueExists).mockResolvedValue(false);
      vi.mocked(storage.createCompany).mockResolvedValue(mockCompany as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies/create",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          companyName: "Test Company",
          tin: "C12345678901",
          brn: "BRN123456",
          industry1: "62010",
          industryCode1: "IT Services",
        },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe("PUT /api/v1/companies/:id", () => {
    it("should update company", async () => {
      vi.mocked(storage.findCompanyById).mockResolvedValue(mockCompany as any);
      vi.mocked(storage.tinIdValueExists).mockResolvedValue(false);
      vi.mocked(storage.updateCompany).mockResolvedValue({
        ...mockCompany,
        name: "Updated Company",
      } as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/companies/company-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Updated Company",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe("Updated Company");
    });

    it("should return 404 for non-existent company", async () => {
      vi.mocked(storage.findCompanyById).mockResolvedValue(null);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/companies/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Updated Company",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 400 if TIN/idValue conflicts with another company", async () => {
      vi.mocked(storage.findCompanyById).mockResolvedValue(mockCompany as any);
      vi.mocked(storage.tinIdValueExists).mockResolvedValue(true);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/companies/company-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          tin: "C99999999999",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("COMPANY_EXISTS");
    });
  });

  describe("PUT /api/v1/companies/:id/credentials", () => {
    it("should update company credentials", async () => {
      vi.mocked(storage.companyExists).mockResolvedValue(true);
      vi.mocked(storage.updateCompanyCredentials).mockResolvedValue({
        ...mockCompany,
        myinvoisClientId: "new-client-id",
        myinvoisClientSecret: "new-secret",
      } as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/companies/company-123/credentials",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          myinvoisClientId: "new-client-id",
          myinvoisClientSecret: "new-secret",
          myinvoisEnv: "PROD",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.hasCredentials).toBe(true);
    });

    it("should return 404 for non-existent company", async () => {
      vi.mocked(storage.companyExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/companies/nonexistent/credentials",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          myinvoisClientId: "new-client-id",
          myinvoisClientSecret: "new-secret",
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /api/v1/companies/:id/users/:userId", () => {
    it("should link user to company", async () => {
      vi.mocked(storage.companyExists).mockResolvedValue(true);
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.isUserLinkedToCompany).mockResolvedValue(false);
      vi.mocked(storage.linkUserToCompany).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies/company-123/users/user-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().message).toContain("linked");
    });

    it("should return 404 if company not found", async () => {
      vi.mocked(storage.companyExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies/nonexistent/users/user-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 404 if user not found", async () => {
      vi.mocked(storage.companyExists).mockResolvedValue(true);
      vi.mocked(storage.userExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies/company-123/users/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 400 if already linked", async () => {
      vi.mocked(storage.companyExists).mockResolvedValue(true);
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.isUserLinkedToCompany).mockResolvedValue(true);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/companies/company-123/users/user-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("ALREADY_LINKED");
    });
  });

  describe("DELETE /api/v1/companies/:id/users/:userId", () => {
    it("should unlink user from company", async () => {
      vi.mocked(storage.isUserLinkedToCompany).mockResolvedValue(true);
      vi.mocked(storage.unlinkUserFromCompany).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/companies/company-123/users/user-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(204);
    });

    it("should return 404 if not linked", async () => {
      vi.mocked(storage.isUserLinkedToCompany).mockResolvedValue(false);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/companies/company-123/users/user-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("NOT_LINKED");
    });
  });

  describe("DELETE /api/v1/companies/:id", () => {
    it("should soft-delete company", async () => {
      vi.mocked(storage.companyExists).mockResolvedValue(true);
      vi.mocked(storage.updateCompany).mockResolvedValue({
        ...mockCompany,
        isActive: false,
      } as any);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/companies/company-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(204);
      expect(storage.updateCompany).toHaveBeenCalledWith("company-123", { isActive: false });
    });

    it("should return 404 for non-existent company", async () => {
      vi.mocked(storage.companyExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/companies/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
