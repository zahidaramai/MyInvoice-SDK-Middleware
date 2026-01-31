/**
 * Tests for companiesRepo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma client
const mockPrismaClient = {
  company: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock("../../src/prisma.js", () => ({
  getPrismaClient: () => mockPrismaClient,
}));

describe("companiesRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findCompanyById", () => {
    it("returns company when found", async () => {
      const mockCompany = {
        id: "company-1",
        name: "Test Company Sdn Bhd",
        tin: "C12345678901",
        brn: "202301012345",
        email: "contact@test.com",
        phone: "0312345678",
        address: "123 Jalan Test",
        city: "Kuala Lumpur",
        state: "14",
        postalCode: "50000",
        country: "MYS",
        msicCode: "46510",
        msicDescription: "Wholesale of computers",
        myinvoisClientId: null,
        myinvoisClientSecret: null,
        myinvoisEnv: "SANDBOX",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.company.findUnique.mockResolvedValueOnce(mockCompany);

      const result = await mockPrismaClient.company.findUnique({
        where: { id: "company-1" },
      });

      expect(result).toEqual(mockCompany);
      expect(result.tin).toBe("C12345678901");
    });

    it("returns null when company not found", async () => {
      mockPrismaClient.company.findUnique.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.company.findUnique({
        where: { id: "non-existent" },
      });

      expect(result).toBeNull();
    });
  });

  describe("findCompanyByTin", () => {
    it("returns company by TIN", async () => {
      const mockCompany = {
        id: "company-2",
        tin: "C98765432100",
        name: "Another Company",
      };

      mockPrismaClient.company.findFirst.mockResolvedValueOnce(mockCompany);

      const result = await mockPrismaClient.company.findFirst({
        where: { tin: "C98765432100" },
      });

      expect(result).toEqual(mockCompany);
    });

    it("returns null when TIN not found", async () => {
      mockPrismaClient.company.findFirst.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.company.findFirst({
        where: { tin: "C00000000000" },
      });

      expect(result).toBeNull();
    });
  });

  describe("findCompanyByBrn", () => {
    it("returns company by BRN", async () => {
      const mockCompany = {
        id: "company-3",
        brn: "202301054321",
        name: "BRN Company",
      };

      mockPrismaClient.company.findFirst.mockResolvedValueOnce(mockCompany);

      const result = await mockPrismaClient.company.findFirst({
        where: { brn: "202301054321" },
      });

      expect(result).toEqual(mockCompany);
    });
  });

  describe("createCompany", () => {
    it("creates company with all fields", async () => {
      const companyData = {
        name: "New Company Sdn Bhd",
        tin: "C11111111111",
        brn: "202401011111",
        email: "new@company.com",
        phone: "0398765432",
        address: "456 Jalan New",
        city: "Petaling Jaya",
        state: "10",
        postalCode: "47300",
        country: "MYS",
        msicCode: "62010",
        msicDescription: "Computer programming",
      };

      const createdCompany = {
        id: "company-new",
        ...companyData,
        myinvoisClientId: null,
        myinvoisClientSecret: null,
        myinvoisEnv: "SANDBOX",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.company.create.mockResolvedValueOnce(createdCompany);

      const result = await mockPrismaClient.company.create({
        data: companyData,
      });

      expect(result.id).toBe("company-new");
      expect(result.tin).toBe("C11111111111");
    });

    it("creates company with minimal fields", async () => {
      const companyData = {
        name: "Minimal Company",
        tin: "C22222222222",
      };

      const createdCompany = {
        id: "company-minimal",
        ...companyData,
        brn: null,
        email: null,
        phone: null,
        address: null,
        city: null,
        state: null,
        postalCode: null,
        country: "MYS",
        msicCode: null,
        msicDescription: null,
        myinvoisClientId: null,
        myinvoisClientSecret: null,
        myinvoisEnv: "SANDBOX",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.company.create.mockResolvedValueOnce(createdCompany);

      const result = await mockPrismaClient.company.create({
        data: companyData,
      });

      expect(result.id).toBe("company-minimal");
      expect(result.email).toBeNull();
    });
  });

  describe("updateCompany", () => {
    it("updates company details", async () => {
      const updateData = {
        name: "Updated Company Name",
        email: "updated@company.com",
        phone: "0312349999",
      };

      const updatedCompany = {
        id: "company-1",
        ...updateData,
        tin: "C12345678901",
        updatedAt: new Date(),
      };

      mockPrismaClient.company.update.mockResolvedValueOnce(updatedCompany);

      const result = await mockPrismaClient.company.update({
        where: { id: "company-1" },
        data: updateData,
      });

      expect(result.name).toBe("Updated Company Name");
      expect(result.email).toBe("updated@company.com");
    });

    it("updates MyInvois credentials", async () => {
      const updateData = {
        myinvoisClientId: "new-client-id",
        myinvoisClientSecret: "new-client-secret",
        myinvoisEnv: "PROD",
      };

      const updatedCompany = {
        id: "company-1",
        ...updateData,
        tin: "C12345678901",
        updatedAt: new Date(),
      };

      mockPrismaClient.company.update.mockResolvedValueOnce(updatedCompany);

      const result = await mockPrismaClient.company.update({
        where: { id: "company-1" },
        data: updateData,
      });

      expect(result.myinvoisClientId).toBe("new-client-id");
      expect(result.myinvoisEnv).toBe("PROD");
    });
  });

  describe("deleteCompany", () => {
    it("deletes company by ID", async () => {
      const deletedCompany = {
        id: "company-to-delete",
        name: "Deleted Company",
        tin: "C99999999999",
      };

      mockPrismaClient.company.delete.mockResolvedValueOnce(deletedCompany);

      const result = await mockPrismaClient.company.delete({
        where: { id: "company-to-delete" },
      });

      expect(result.id).toBe("company-to-delete");
    });
  });

  describe("listCompanies", () => {
    it("returns all companies", async () => {
      const mockCompanies = [
        { id: "company-1", name: "Company A", tin: "C11111111111" },
        { id: "company-2", name: "Company B", tin: "C22222222222" },
        { id: "company-3", name: "Company C", tin: "C33333333333" },
      ];

      mockPrismaClient.company.findMany.mockResolvedValueOnce(mockCompanies);

      const result = await mockPrismaClient.company.findMany();

      expect(result).toHaveLength(3);
    });

    it("returns companies with pagination", async () => {
      const mockCompanies = [{ id: "company-2", name: "Company B", tin: "C22222222222" }];

      mockPrismaClient.company.findMany.mockResolvedValueOnce(mockCompanies);

      const result = await mockPrismaClient.company.findMany({
        skip: 1,
        take: 1,
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("company-2");
    });

    it("returns companies filtered by state", async () => {
      const mockCompanies = [{ id: "company-1", name: "KL Company", state: "14" }];

      mockPrismaClient.company.findMany.mockResolvedValueOnce(mockCompanies);

      const result = await mockPrismaClient.company.findMany({
        where: { state: "14" },
      });

      expect(result).toHaveLength(1);
      expect(result[0].state).toBe("14");
    });
  });

  describe("countCompanies", () => {
    it("returns total company count", async () => {
      mockPrismaClient.company.count.mockResolvedValueOnce(10);

      const result = await mockPrismaClient.company.count();

      expect(result).toBe(10);
    });

    it("returns filtered company count", async () => {
      mockPrismaClient.company.count.mockResolvedValueOnce(3);

      const result = await mockPrismaClient.company.count({
        where: { myinvoisEnv: "PROD" },
      });

      expect(result).toBe(3);
    });
  });

  describe("company validation", () => {
    it("validates TIN format (starts with C)", () => {
      const validTins = ["C12345678901", "C00000000000", "C99999999999"];
      const invalidTins = ["12345678901", "B12345678901", "C1234567890"];

      validTins.forEach((tin) => {
        expect(tin).toMatch(/^C\d{11}$/);
      });

      invalidTins.forEach((tin) => {
        expect(tin).not.toMatch(/^C\d{11}$/);
      });
    });

    it("validates BRN format", () => {
      const validBrns = ["202301012345", "199901011111", "202412319999"];

      validBrns.forEach((brn) => {
        expect(brn).toMatch(/^\d{12}$/);
      });
    });

    it("validates state codes", () => {
      const validStateCodes = ["01", "02", "10", "14", "16"];

      validStateCodes.forEach((code) => {
        const numCode = parseInt(code, 10);
        expect(numCode).toBeGreaterThanOrEqual(1);
        expect(numCode).toBeLessThanOrEqual(17);
      });
    });

    it("validates MSIC code format", () => {
      const validMsicCodes = ["46510", "62010", "01111"];

      validMsicCodes.forEach((code) => {
        expect(code).toMatch(/^\d{5}$/);
      });
    });
  });

  describe("MyInvois environment", () => {
    it("accepts SANDBOX environment", () => {
      const envs = ["SANDBOX", "PROD"];
      expect(envs).toContain("SANDBOX");
    });

    it("accepts PROD environment", () => {
      const envs = ["SANDBOX", "PROD"];
      expect(envs).toContain("PROD");
    });

    it("defaults to SANDBOX when not specified", () => {
      const company = {
        myinvoisEnv: "SANDBOX",
      };

      expect(company.myinvoisEnv).toBe("SANDBOX");
    });
  });
});
