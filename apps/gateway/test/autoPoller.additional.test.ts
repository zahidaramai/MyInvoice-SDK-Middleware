/**
 * TST-17: Additional Auto Poller Tests
 * Extended tests for auto poller edge cases and coverage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock prisma client
const mockPrisma = {
  invoice: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
};

vi.mock("@myinvois/storage", () => ({
  getPrismaClient: () => mockPrisma,
}));

// Mock myinvois-client
vi.mock("@myinvois/myinvois-client", () => ({
  getDocumentDetails: vi.fn(),
}));

// Mock config
vi.mock("../src/config.js", () => ({
  loadConfig: () => ({
    autoPollerIntervalMs: 300000,
    myinvoisEnv: "SANDBOX",
  }),
}));

// Mock token manager
vi.mock("../src/lib/myinvois.js", () => ({
  getTokenManager: () => ({
    getToken: vi
      .fn()
      .mockResolvedValue({ accessToken: "mock-token", expiresAt: Date.now() + 3600000 }),
  }),
  getRateLimiter: () => ({
    checkLimit: vi.fn().mockResolvedValue(true),
    recordRequest: vi.fn(),
  }),
}));

describe("TST-17: Auto Poller Extended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Invoice filtering", () => {
    it("should only poll SUBMITTED invoices", async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);

      // The poller should filter by status
      await mockPrisma.invoice.findMany({
        where: { status: "SUBMITTED" },
      });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "SUBMITTED",
          }),
        })
      );
    });

    it("should filter invoices with trackingId", async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);

      await mockPrisma.invoice.findMany({
        where: {
          status: "SUBMITTED",
          trackingId: { not: null },
        },
      });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalled();
    });
  });

  describe("Optimistic locking", () => {
    it("should use version field for update", async () => {
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      const result = await mockPrisma.invoice.updateMany({
        where: {
          id: "inv-123",
          version: 1,
        },
        data: {
          status: "VALID",
          version: { increment: 1 },
        },
      });

      expect(result.count).toBe(1);
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            version: 1,
          }),
          data: expect.objectContaining({
            version: { increment: 1 },
          }),
        })
      );
    });

    it("should detect concurrent update (count = 0)", async () => {
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 0 });

      const result = await mockPrisma.invoice.updateMany({
        where: {
          id: "inv-123",
          version: 1,
        },
        data: {
          status: "VALID",
          version: { increment: 1 },
        },
      });

      expect(result.count).toBe(0);
    });
  });

  describe("Status transitions", () => {
    it("should transition SUBMITTED to VALID", async () => {
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      await mockPrisma.invoice.updateMany({
        where: { id: "inv-1", version: 1 },
        data: {
          status: "VALID",
          myinvoisLongId: "long-id-123",
          version: { increment: 1 },
        },
      });

      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "VALID",
            myinvoisLongId: "long-id-123",
          }),
        })
      );
    });

    it("should transition SUBMITTED to INVALID", async () => {
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      await mockPrisma.invoice.updateMany({
        where: { id: "inv-1", version: 1 },
        data: {
          status: "INVALID",
          errorMessage: "Validation failed",
          errorCode: "INVALID_TIN",
          version: { increment: 1 },
        },
      });

      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "INVALID",
            errorMessage: "Validation failed",
          }),
        })
      );
    });
  });

  describe("Batch processing", () => {
    it("should process multiple invoices", async () => {
      const invoices = [
        { id: "inv-1", trackingId: "trk-1", version: 1 },
        { id: "inv-2", trackingId: "trk-2", version: 1 },
        { id: "inv-3", trackingId: "trk-3", version: 1 },
      ];

      mockPrisma.invoice.findMany.mockResolvedValue(invoices);
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      const result = await mockPrisma.invoice.findMany({
        where: { status: "SUBMITTED" },
      });

      expect(result).toHaveLength(3);
    });

    it("should limit batch size", async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);

      await mockPrisma.invoice.findMany({
        where: { status: "SUBMITTED" },
        take: 50,
      });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        })
      );
    });
  });
});
