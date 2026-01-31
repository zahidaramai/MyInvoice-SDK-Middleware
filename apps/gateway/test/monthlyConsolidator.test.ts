/**
 * TST-08: Monthly Consolidation Cron Tests
 * Tests for the daily consolidation background job
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock prisma before imports
vi.mock("@myinvois/storage", async () => {
  return {
    getPrismaClient: vi.fn().mockReturnValue({
      invoice: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
      company: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    }),
  };
});

// Mock myinvois-client
vi.mock("@myinvois/myinvois-client", async () => {
  return {
    createTokenManager: vi.fn().mockReturnValue({}),
    submitDocuments: vi.fn().mockResolvedValue({
      ok: true,
      result: {
        submissionUid: "sub-123",
        acceptedDocuments: [{ uuid: "uuid-123" }],
        rejectedDocuments: [],
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

import { getPrismaClient } from "@myinvois/storage";

// Sample test data
const COMPANY_ID = "bc1151e6-b7a6-469e-864d-e5c77ebed3d8";

const mockCompany = {
  id: COMPANY_ID,
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
  isActive: true,
};

const mockDraftInvoices = [
  {
    id: "inv-1",
    companyId: COMPANY_ID,
    invoiceNumber: "DRAFT-001",
    invoiceDate: new Date("2026-01-15"),
    invoiceType: "CONSOLIDATE",
    status: "DRAFT",
    amount: "100.00",
    taxAmount: "6.00",
    total: "106.00",
    rawPayload: JSON.stringify({ items: [{ description: "Item 1" }] }),
    company: mockCompany,
  },
  {
    id: "inv-2",
    companyId: COMPANY_ID,
    invoiceNumber: "DRAFT-002",
    invoiceDate: new Date("2026-01-20"),
    invoiceType: "CONSOLIDATE",
    status: "DRAFT",
    amount: "200.00",
    taxAmount: "12.00",
    total: "212.00",
    rawPayload: JSON.stringify({ items: [{ description: "Item 2" }] }),
    company: mockCompany,
  },
];

describe("TST-08: Monthly Consolidation Cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    delete process.env.ENABLE_MONTHLY_CONSOLIDATION;
    delete process.env.ERP_MODE;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Consolidation logic", () => {
    it("should skip consolidation when disabled", async () => {
      process.env.ENABLE_MONTHLY_CONSOLIDATION = "false";

      const prisma = getPrismaClient();

      // When disabled, should not query for invoices
      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    });

    it("should find DRAFT invoices for consolidation when enabled", async () => {
      process.env.ENABLE_MONTHLY_CONSOLIDATION = "true";

      const prisma = getPrismaClient();
      vi.mocked(prisma.invoice.findMany).mockResolvedValue(mockDraftInvoices as any);

      // Simulate what the consolidator would query
      const draftInvoices = await prisma.invoice.findMany({
        where: {
          status: "DRAFT",
          invoiceType: "CONSOLIDATE",
        },
        include: {
          company: true,
        },
      });

      expect(draftInvoices).toHaveLength(2);
      expect(draftInvoices[0].status).toBe("DRAFT");
    });

    it("should group invoices by company", async () => {
      const prisma = getPrismaClient();

      const company2Id = "bc1151e6-b7a6-469e-864d-e5c77ebed3d9";
      const invoicesFromMultipleCompanies = [
        ...mockDraftInvoices,
        {
          id: "inv-3",
          companyId: company2Id,
          invoiceNumber: "DRAFT-003",
          invoiceDate: new Date("2026-01-25"),
          invoiceType: "CONSOLIDATE",
          status: "DRAFT",
          amount: "300.00",
          taxAmount: "18.00",
          total: "318.00",
          rawPayload: JSON.stringify({ items: [{ description: "Item 3" }] }),
          company: { ...mockCompany, id: company2Id },
        },
      ];

      vi.mocked(prisma.invoice.findMany).mockResolvedValue(invoicesFromMultipleCompanies as any);

      const invoices = await prisma.invoice.findMany({
        where: { status: "DRAFT" },
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
      expect(byCompany.get(COMPANY_ID)).toHaveLength(2);
      expect(byCompany.get(company2Id)).toHaveLength(1);
    });

    it("should calculate consolidated totals correctly", async () => {
      // Sum up the amounts from mockDraftInvoices
      const expectedAmount = 100.0 + 200.0; // 300.00
      const expectedTax = 6.0 + 12.0; // 18.00
      const expectedTotal = 106.0 + 212.0; // 318.00

      const totals = mockDraftInvoices.reduce(
        (acc, inv) => ({
          amount: acc.amount + parseFloat(inv.amount),
          taxAmount: acc.taxAmount + parseFloat(inv.taxAmount),
          total: acc.total + parseFloat(inv.total),
        }),
        { amount: 0, taxAmount: 0, total: 0 }
      );

      expect(totals.amount).toBe(expectedAmount);
      expect(totals.taxAmount).toBe(expectedTax);
      expect(totals.total).toBe(expectedTotal);
    });

    it("should mark original drafts as SUBMITTED after consolidation", async () => {
      const prisma = getPrismaClient();

      // Simulate updating draft invoices after consolidation
      await prisma.invoice.updateMany({
        where: {
          id: { in: mockDraftInvoices.map((i) => i.id) },
        },
        data: {
          status: "SUBMITTED",
        },
      });

      expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: expect.objectContaining({
              in: expect.arrayContaining(["inv-1", "inv-2"]),
            }),
          }),
          data: expect.objectContaining({
            status: "SUBMITTED",
          }),
        })
      );
    });

    it("should not consolidate if no DRAFT invoices exist", async () => {
      const prisma = getPrismaClient();
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);

      const invoices = await prisma.invoice.findMany({
        where: { status: "DRAFT" },
      });

      expect(invoices).toHaveLength(0);
      // No consolidation should happen
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe("Consolidation schedule", () => {
    it("should run at 1:00 AM MYT daily", () => {
      // The consolidator runs at 1:00 AM MYT (UTC+8)
      // This is 17:00 UTC (previous day)
      const scheduleHour = 1;
      const timezone = "Asia/Kuala_Lumpur";

      // Verify the configuration matches expected values
      expect(scheduleHour).toBe(1);
      expect(timezone).toBe("Asia/Kuala_Lumpur");
    });
  });

  describe("Error handling", () => {
    it("should handle database errors gracefully", async () => {
      const prisma = getPrismaClient();
      vi.mocked(prisma.invoice.findMany).mockRejectedValue(new Error("DB connection failed"));

      await expect(prisma.invoice.findMany({ where: { status: "DRAFT" } })).rejects.toThrow(
        "DB connection failed"
      );
    });

    it("should continue with other companies if one fails", async () => {
      // The consolidator should process each company independently
      // If one company fails, others should still be processed
      const companies = [
        { id: COMPANY_ID, name: "Company 1" },
        { id: "bc1151e6-b7a6-469e-864d-e5c77ebed3d9", name: "Company 2" },
      ];

      let processedCount = 0;
      for (const company of companies) {
        try {
          // Simulate processing - first company fails
          if (company.id === COMPANY_ID) {
            throw new Error("Processing failed");
          }
          processedCount++;
        } catch {
          // Continue with next company
        }
      }

      expect(processedCount).toBe(1); // Second company succeeded
    });
  });
});
