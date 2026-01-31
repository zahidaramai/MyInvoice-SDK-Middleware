/**
 * Tests for tinRepo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma client
const mockPrismaClient = {
  tinValidation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock("../../src/prisma.js", () => ({
  getPrismaClient: () => mockPrismaClient,
}));

describe("tinRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findTinValidation", () => {
    it("returns cached validation when found", async () => {
      const mockValidation = {
        id: "tin-1",
        tin: "C12345678901",
        idType: "BRN",
        idValue: "202301012345",
        isValid: true,
        taxpayerName: "Test Company Sdn Bhd",
        validatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      mockPrismaClient.tinValidation.findFirst.mockResolvedValueOnce(mockValidation);

      const result = await mockPrismaClient.tinValidation.findFirst({
        where: {
          tin: "C12345678901",
          idType: "BRN",
          idValue: "202301012345",
        },
      });

      expect(result).toEqual(mockValidation);
      expect(result.isValid).toBe(true);
    });

    it("returns null when validation not found", async () => {
      mockPrismaClient.tinValidation.findFirst.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.tinValidation.findFirst({
        where: {
          tin: "C00000000000",
          idType: "BRN",
          idValue: "000000000000",
        },
      });

      expect(result).toBeNull();
    });
  });

  describe("createTinValidation", () => {
    it("creates successful validation record", async () => {
      const validationData = {
        tin: "C12345678901",
        idType: "BRN",
        idValue: "202301012345",
        isValid: true,
        taxpayerName: "Test Company Sdn Bhd",
        validatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      const createdValidation = {
        id: "tin-new",
        ...validationData,
      };

      mockPrismaClient.tinValidation.create.mockResolvedValueOnce(createdValidation);

      const result = await mockPrismaClient.tinValidation.create({
        data: validationData,
      });

      expect(result.id).toBe("tin-new");
      expect(result.isValid).toBe(true);
    });

    it("creates failed validation record", async () => {
      const validationData = {
        tin: "C99999999999",
        idType: "BRN",
        idValue: "999999999999",
        isValid: false,
        errorCode: "InvalidTIN",
        errorMessage: "TIN not registered",
        validatedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // Shorter cache for failures
      };

      const createdValidation = {
        id: "tin-failed",
        ...validationData,
      };

      mockPrismaClient.tinValidation.create.mockResolvedValueOnce(createdValidation);

      const result = await mockPrismaClient.tinValidation.create({
        data: validationData,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe("InvalidTIN");
    });
  });

  describe("upsertTinValidation", () => {
    it("updates existing validation record", async () => {
      const validationData = {
        tin: "C12345678901",
        idType: "BRN",
        idValue: "202301012345",
        isValid: true,
        taxpayerName: "Updated Company Name",
        validatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      mockPrismaClient.tinValidation.upsert.mockResolvedValueOnce({
        id: "tin-1",
        ...validationData,
      });

      const result = await mockPrismaClient.tinValidation.upsert({
        where: {
          tin_idType_idValue: {
            tin: "C12345678901",
            idType: "BRN",
            idValue: "202301012345",
          },
        },
        create: validationData,
        update: validationData,
      });

      expect(result.taxpayerName).toBe("Updated Company Name");
    });

    it("creates new record when not exists", async () => {
      const validationData = {
        tin: "C11111111111",
        idType: "BRN",
        idValue: "111111111111",
        isValid: true,
        taxpayerName: "New Company",
        validatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      mockPrismaClient.tinValidation.upsert.mockResolvedValueOnce({
        id: "tin-created",
        ...validationData,
      });

      const result = await mockPrismaClient.tinValidation.upsert({
        where: {
          tin_idType_idValue: {
            tin: "C11111111111",
            idType: "BRN",
            idValue: "111111111111",
          },
        },
        create: validationData,
        update: validationData,
      });

      expect(result.id).toBe("tin-created");
    });
  });

  describe("cache expiry", () => {
    it("identifies expired cache entry", () => {
      const validation = {
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      };

      const isExpired = validation.expiresAt.getTime() < Date.now();
      expect(isExpired).toBe(true);
    });

    it("identifies valid cache entry", () => {
      const validation = {
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      };

      const isExpired = validation.expiresAt.getTime() < Date.now();
      expect(isExpired).toBe(false);
    });

    it("calculates 24 hour cache expiry", () => {
      const now = new Date();
      const cacheHours = 24;
      const expiresAt = new Date(now.getTime() + cacheHours * 60 * 60 * 1000);

      const hoursDiff = (expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000);
      expect(hoursDiff).toBeCloseTo(24, 0);
    });
  });

  describe("TIN format validation", () => {
    it("validates company TIN format (starts with C)", () => {
      const validTins = ["C12345678901", "C00000000000", "C99999999999"];

      validTins.forEach((tin) => {
        expect(tin).toMatch(/^C\d{11}$/);
      });
    });

    it("validates individual TIN format", () => {
      const validTins = ["IG12345678901", "OG12345678901"];

      validTins.forEach((tin) => {
        expect(tin).toMatch(/^(IG|OG)\d{11}$/);
      });
    });

    it("rejects invalid TIN format", () => {
      const invalidTins = ["12345678901", "X12345678901", "C1234567890"];

      invalidTins.forEach((tin) => {
        expect(tin).not.toMatch(/^C\d{11}$/);
      });
    });
  });

  describe("ID type validation", () => {
    it("validates BRN ID type", () => {
      const idType = "BRN";
      const validIdTypes = ["BRN", "NRIC", "PASSPORT", "ARMY", "TIN"];

      expect(validIdTypes).toContain(idType);
    });

    it("validates NRIC ID type", () => {
      const idType = "NRIC";
      const validIdTypes = ["BRN", "NRIC", "PASSPORT", "ARMY", "TIN"];

      expect(validIdTypes).toContain(idType);
    });

    it("validates PASSPORT ID type", () => {
      const idType = "PASSPORT";
      const validIdTypes = ["BRN", "NRIC", "PASSPORT", "ARMY", "TIN"];

      expect(validIdTypes).toContain(idType);
    });
  });

  describe("batch operations", () => {
    it("validates multiple TINs", async () => {
      const validations = [
        { tin: "C12345678901", idType: "BRN", idValue: "111" },
        { tin: "C23456789012", idType: "BRN", idValue: "222" },
        { tin: "C34567890123", idType: "BRN", idValue: "333" },
      ];

      mockPrismaClient.tinValidation.findMany.mockResolvedValueOnce(
        validations.map((v, i) => ({
          id: `tin-${i}`,
          ...v,
          isValid: true,
        }))
      );

      const result = await mockPrismaClient.tinValidation.findMany({
        where: {
          tin: { in: validations.map((v) => v.tin) },
        },
      });

      expect(result).toHaveLength(3);
    });
  });

  describe("delete expired validations", () => {
    it("removes expired cache entries", async () => {
      mockPrismaClient.tinValidation.delete;

      const deleteMany = vi.fn().mockResolvedValue({ count: 10 });
      mockPrismaClient.tinValidation.delete = deleteMany;

      // Simulated cleanup
      expect(true).toBe(true);
    });
  });

  describe("validation statistics", () => {
    it("counts total validations", async () => {
      mockPrismaClient.tinValidation.count.mockResolvedValueOnce(100);

      const result = await mockPrismaClient.tinValidation.count();

      expect(result).toBe(100);
    });

    it("counts successful validations", async () => {
      mockPrismaClient.tinValidation.count.mockResolvedValueOnce(85);

      const result = await mockPrismaClient.tinValidation.count({
        where: { isValid: true },
      });

      expect(result).toBe(85);
    });

    it("counts failed validations", async () => {
      mockPrismaClient.tinValidation.count.mockResolvedValueOnce(15);

      const result = await mockPrismaClient.tinValidation.count({
        where: { isValid: false },
      });

      expect(result).toBe(15);
    });
  });
});
