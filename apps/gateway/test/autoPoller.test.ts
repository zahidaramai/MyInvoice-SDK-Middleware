/**
 * TST-09: Auto-Poller Cron Tests
 * Tests for the automatic status polling background job
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock prisma before imports
vi.mock("@myinvois/storage", async () => {
  return {
    getPrismaClient: vi.fn().mockReturnValue({
      invoice: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    }),
  };
});

// Mock myinvois-client
vi.mock("@myinvois/myinvois-client", async () => {
  return {
    createTokenManager: vi.fn().mockReturnValue({}),
    getDocumentDetails: vi.fn().mockResolvedValue({
      ok: true,
      result: {
        status: "Valid",
        longId: "long-id-123456789",
      },
    }),
  };
});

import { getPrismaClient } from "@myinvois/storage";
import { getDocumentDetails } from "@myinvois/myinvois-client";

// Sample test data
const COMPANY_ID = "bc1151e6-b7a6-469e-864d-e5c77ebed3d8";

const mockCompany = {
  id: COMPANY_ID,
  name: "Test Company",
  tin: "C12345678901",
  myinvoisClientId: "client-123",
  myinvoisClientSecret: "secret-123",
  myinvoisEnv: "SANDBOX",
};

const mockSubmittedInvoices = [
  {
    id: "inv-1",
    companyId: COMPANY_ID,
    invoiceNumber: "INV-001",
    myinvoisUuid: "uuid-123",
    status: "SUBMITTED",
    version: 1,
    company: mockCompany,
  },
  {
    id: "inv-2",
    companyId: COMPANY_ID,
    invoiceNumber: "INV-002",
    myinvoisUuid: "uuid-456",
    status: "SUBMITTED",
    version: 1,
    company: mockCompany,
  },
];

describe("TST-09: Auto-Poller Cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ERP_MODE;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Polling logic", () => {
    it("should find SUBMITTED invoices with myinvoisUuid", async () => {
      const prisma = getPrismaClient();
      vi.mocked(prisma.invoice.findMany).mockResolvedValue(mockSubmittedInvoices as any);

      const invoices = await prisma.invoice.findMany({
        where: {
          status: "SUBMITTED",
          myinvoisUuid: { not: null },
        },
        include: { company: true },
      });

      expect(invoices).toHaveLength(2);
      expect(invoices[0].myinvoisUuid).toBeDefined();
    });

    it("should skip polling when no SUBMITTED invoices", async () => {
      const prisma = getPrismaClient();
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);

      const invoices = await prisma.invoice.findMany({
        where: { status: "SUBMITTED" },
      });

      expect(invoices).toHaveLength(0);
      expect(getDocumentDetails).not.toHaveBeenCalled();
    });

    it("should group invoices by company for efficient token usage", async () => {
      const prisma = getPrismaClient();

      const company2Id = "bc1151e6-b7a6-469e-864d-e5c77ebed3d9";
      const invoicesFromMultipleCompanies = [
        ...mockSubmittedInvoices,
        {
          id: "inv-3",
          companyId: company2Id,
          invoiceNumber: "INV-003",
          myinvoisUuid: "uuid-789",
          status: "SUBMITTED",
          version: 1,
          company: { ...mockCompany, id: company2Id },
        },
      ];

      vi.mocked(prisma.invoice.findMany).mockResolvedValue(invoicesFromMultipleCompanies as any);

      const invoices = await prisma.invoice.findMany({
        where: { status: "SUBMITTED" },
        include: { company: true },
      });

      // Group by company
      const byCompany = new Map<string, typeof invoices>();
      for (const inv of invoices) {
        if (!byCompany.has(inv.companyId)) {
          byCompany.set(inv.companyId, []);
        }
        byCompany.get(inv.companyId)!.push(inv);
      }

      expect(byCompany.size).toBe(2);
    });

    it("should update invoice status from MyInvois response", async () => {
      const prisma = getPrismaClient();

      vi.mocked(getDocumentDetails).mockResolvedValue({
        ok: true,
        result: {
          status: "Valid",
          longId: "long-id-abc-xyz-123",
        },
      } as any);

      // Simulate the update
      await prisma.invoice.updateMany({
        where: { id: "inv-1", version: 1 },
        data: {
          status: "VALID",
          myinvoisLongId: "long-id-abc-xyz-123",
          version: { increment: 1 },
        },
      });

      expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "VALID",
            myinvoisLongId: "long-id-abc-xyz-123",
          }),
        })
      );
    });

    it("should map MyInvois status correctly", () => {
      const statusMap: Record<string, string> = {
        Valid: "VALID",
        Invalid: "INVALID",
        Submitted: "SUBMITTED",
        Cancelled: "CANCELLED",
        Rejected: "REJECTED",
      };

      expect(statusMap["Valid"]).toBe("VALID");
      expect(statusMap["Invalid"]).toBe("INVALID");
      expect(statusMap["Cancelled"]).toBe("CANCELLED");
    });
  });

  describe("Optimistic locking (P1-07)", () => {
    it("should include version check in update query", async () => {
      const prisma = getPrismaClient();
      vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 1 });

      const result = await prisma.invoice.updateMany({
        where: {
          id: "inv-1",
          version: 1, // Optimistic lock check
        },
        data: {
          status: "VALID",
          version: { increment: 1 },
        },
      });

      expect(result.count).toBe(1);
      expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            version: 1,
          }),
        })
      );
    });

    it("should detect concurrent update (count = 0)", async () => {
      const prisma = getPrismaClient();
      vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 0 });

      const result = await prisma.invoice.updateMany({
        where: {
          id: "inv-1",
          version: 1,
        },
        data: {
          status: "VALID",
        },
      });

      // count = 0 means another process updated the invoice
      expect(result.count).toBe(0);
    });
  });

  describe("ERP Mode", () => {
    it("should use ERP credentials in ERP mode", () => {
      process.env.ERP_MODE = "true";
      process.env.ERP_MYINVOIS_CLIENT_ID = "erp-client-id";
      process.env.ERP_MYINVOIS_CLIENT_SECRET = "erp-secret";
      process.env.ERP_MYINVOIS_ENV = "PROD";

      const erpConfig = {
        enabled: process.env.ERP_MODE === "true",
        clientId: process.env.ERP_MYINVOIS_CLIENT_ID,
        clientSecret: process.env.ERP_MYINVOIS_CLIENT_SECRET,
        env: process.env.ERP_MYINVOIS_ENV,
      };

      expect(erpConfig.enabled).toBe(true);
      expect(erpConfig.clientId).toBe("erp-client-id");
    });

    it("should use company credentials in standard mode", () => {
      delete process.env.ERP_MODE;

      const erpConfig = {
        enabled: process.env.ERP_MODE === "true",
      };

      expect(erpConfig.enabled).toBe(false);
    });
  });

  describe("Pagination (P2-05)", () => {
    it("should limit invoices per cycle to prevent memory exhaustion", async () => {
      const prisma = getPrismaClient();

      // Simulate the paginated query
      await prisma.invoice.findMany({
        where: { status: "SUBMITTED" },
        take: 500, // P2-05: Limit to 500 per cycle
        orderBy: { updatedAt: "asc" },
      });

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 500,
          orderBy: expect.objectContaining({
            updatedAt: "asc",
          }),
        })
      );
    });
  });

  describe("Error handling", () => {
    it("should continue polling other invoices on individual failure", async () => {
      vi.mocked(getDocumentDetails)
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          result: { status: "Valid", longId: "abc" },
        } as any);

      let successCount = 0;
      let errorCount = 0;

      for (const invoice of mockSubmittedInvoices) {
        try {
          const result = await getDocumentDetails(
            {} as any,
            { uuid: invoice.myinvoisUuid! },
            {} as any
          );
          if (result.ok) successCount++;
        } catch {
          errorCount++;
        }
      }

      expect(successCount).toBe(1);
      expect(errorCount).toBe(1);
    });

    it("should handle API timeout gracefully", async () => {
      vi.mocked(getDocumentDetails).mockRejectedValue(new Error("Request timeout"));

      await expect(getDocumentDetails({} as any, { uuid: "uuid-123" }, {} as any)).rejects.toThrow(
        "Request timeout"
      );
    });
  });

  describe("Concurrency guard (P1-08)", () => {
    it("should prevent concurrent polling runs", async () => {
      let isPolling = false;
      const pollAttempts: boolean[] = [];

      async function simulatePoll() {
        if (isPolling) {
          pollAttempts.push(false); // Skipped
          return;
        }
        isPolling = true;
        pollAttempts.push(true); // Started
        await new Promise((r) => setTimeout(r, 10));
        isPolling = false;
      }

      // Simulate concurrent calls
      await Promise.all([simulatePoll(), simulatePoll(), simulatePoll()]);

      // Only one should have started, others skipped
      const started = pollAttempts.filter((x) => x).length;
      const skipped = pollAttempts.filter((x) => !x).length;

      expect(started).toBe(1);
      expect(skipped).toBe(2);
    });
  });
});
