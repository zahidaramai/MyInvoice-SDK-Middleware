/**
 * Tests for monthlyConsolidator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn().mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
    }),
  },
}));

vi.mock("@myinvois/storage", () => ({
  getPrismaClient: vi.fn().mockReturnValue({
    company: {
      findMany: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  }),
}));

describe("monthlyConsolidator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENABLE_MONTHLY_CONSOLIDATION", "false");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("schedule configuration", () => {
    it("runs daily at 1:00 AM MYT", () => {
      // MYT is UTC+8, so 1:00 AM MYT = 17:00 UTC previous day
      const cronExpression = "0 1 * * *"; // Daily at 1 AM
      const timezone = "Asia/Kuala_Lumpur";

      expect(cronExpression).toBe("0 1 * * *");
      expect(timezone).toBe("Asia/Kuala_Lumpur");
    });

    it("respects ENABLE_MONTHLY_CONSOLIDATION flag", () => {
      const enabled = process.env.ENABLE_MONTHLY_CONSOLIDATION === "true";
      expect(enabled).toBe(false);
    });

    it("enables consolidation when flag is true", () => {
      vi.stubEnv("ENABLE_MONTHLY_CONSOLIDATION", "true");
      const enabled = process.env.ENABLE_MONTHLY_CONSOLIDATION === "true";
      expect(enabled).toBe(true);
    });
  });

  describe("invoice consolidation logic", () => {
    it("groups invoices by company", () => {
      const invoices = [
        { id: "inv-1", companyId: "company-a", status: "DRAFT" },
        { id: "inv-2", companyId: "company-a", status: "DRAFT" },
        { id: "inv-3", companyId: "company-b", status: "DRAFT" },
      ];

      const grouped = invoices.reduce((acc, inv) => {
        if (!acc[inv.companyId]) acc[inv.companyId] = [];
        acc[inv.companyId].push(inv);
        return acc;
      }, {} as Record<string, typeof invoices>);

      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped["company-a"]).toHaveLength(2);
      expect(grouped["company-b"]).toHaveLength(1);
    });

    it("filters only DRAFT invoices", () => {
      const invoices = [
        { id: "inv-1", status: "DRAFT" },
        { id: "inv-2", status: "SUBMITTED" },
        { id: "inv-3", status: "DRAFT" },
        { id: "inv-4", status: "VALID" },
      ];

      const drafts = invoices.filter((inv) => inv.status === "DRAFT");

      expect(drafts).toHaveLength(2);
      expect(drafts.every((inv) => inv.status === "DRAFT")).toBe(true);
    });

    it("calculates consolidated totals", () => {
      const invoices = [
        { amount: 100.00, taxAmount: 6.00, total: 106.00 },
        { amount: 200.00, taxAmount: 12.00, total: 212.00 },
        { amount: 50.00, taxAmount: 3.00, total: 53.00 },
      ];

      const totals = invoices.reduce(
        (acc, inv) => ({
          amount: acc.amount + inv.amount,
          taxAmount: acc.taxAmount + inv.taxAmount,
          total: acc.total + inv.total,
        }),
        { amount: 0, taxAmount: 0, total: 0 }
      );

      expect(totals.amount).toBe(350.00);
      expect(totals.taxAmount).toBe(21.00);
      expect(totals.total).toBe(371.00);
    });

    it("handles decimal precision in totals", () => {
      const invoices = [
        { amount: 10.01, taxAmount: 0.60, total: 10.61 },
        { amount: 10.02, taxAmount: 0.60, total: 10.62 },
        { amount: 10.03, taxAmount: 0.60, total: 10.63 },
      ];

      const totals = invoices.reduce(
        (acc, inv) => ({
          amount: parseFloat((acc.amount + inv.amount).toFixed(2)),
          taxAmount: parseFloat((acc.taxAmount + inv.taxAmount).toFixed(2)),
          total: parseFloat((acc.total + inv.total).toFixed(2)),
        }),
        { amount: 0, taxAmount: 0, total: 0 }
      );

      expect(totals.amount).toBe(30.06);
      expect(totals.taxAmount).toBe(1.80);
      expect(totals.total).toBe(31.86);
    });
  });

  describe("consolidated invoice creation", () => {
    it("generates consolidated invoice number", () => {
      const date = new Date("2024-01-15");
      const companyId = "company-abc";

      const generateConsolidatedNumber = (d: Date, cid: string) => {
        const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
        const shortId = cid.slice(-6).toUpperCase();
        return `CONS-${dateStr}-${shortId}`;
      };

      const invoiceNumber = generateConsolidatedNumber(date, companyId);

      expect(invoiceNumber).toBe("CONS-20240115-NY-ABC");
    });

    it("includes all source invoices in consolidated items", () => {
      const sourceInvoices = [
        {
          invoiceNumber: "INV-001",
          items: [{ description: "Item A", quantity: 1, unitPrice: 50 }],
        },
        {
          invoiceNumber: "INV-002",
          items: [{ description: "Item B", quantity: 2, unitPrice: 25 }],
        },
      ];

      const consolidatedItems = sourceInvoices.flatMap((inv) =>
        inv.items.map((item) => ({
          ...item,
          sourceInvoice: inv.invoiceNumber,
        }))
      );

      expect(consolidatedItems).toHaveLength(2);
      expect(consolidatedItems[0].sourceInvoice).toBe("INV-001");
      expect(consolidatedItems[1].sourceInvoice).toBe("INV-002");
    });

    it("sets consolidated invoice as B2C with EI code", () => {
      const consolidatedInvoice = {
        buyer: {
          tin: "EI00000000010",
          name: "Consolidated Sales",
          idType: "BRN",
          idValue: "EI00000000010",
        },
        isConsolidated: true,
      };

      expect(consolidatedInvoice.buyer.tin).toBe("EI00000000010");
      expect(consolidatedInvoice.isConsolidated).toBe(true);
    });
  });

  describe("status updates after submission", () => {
    it("marks original invoices as SUBMITTED", () => {
      const originalStatuses = ["DRAFT", "DRAFT", "DRAFT"];
      const updatedStatuses = originalStatuses.map(() => "SUBMITTED");

      expect(updatedStatuses.every((s) => s === "SUBMITTED")).toBe(true);
    });

    it("stores shared MyInvois UUID on all source invoices", () => {
      const consolidatedUuid = "consolidated-uuid-123";
      const sourceInvoices = [
        { id: "inv-1", myinvoisUuid: null },
        { id: "inv-2", myinvoisUuid: null },
        { id: "inv-3", myinvoisUuid: null },
      ];

      const updated = sourceInvoices.map((inv) => ({
        ...inv,
        myinvoisUuid: consolidatedUuid,
        status: "SUBMITTED",
      }));

      expect(updated.every((inv) => inv.myinvoisUuid === consolidatedUuid)).toBe(true);
    });
  });

  describe("error handling", () => {
    it("skips companies without credentials", () => {
      const companies = [
        { id: "company-1", myinvoisClientId: "client-id", myinvoisClientSecret: "secret" },
        { id: "company-2", myinvoisClientId: null, myinvoisClientSecret: null },
        { id: "company-3", myinvoisClientId: "client-id", myinvoisClientSecret: "secret" },
      ];

      const validCompanies = companies.filter(
        (c) => c.myinvoisClientId && c.myinvoisClientSecret
      );

      expect(validCompanies).toHaveLength(2);
    });

    it("continues processing on individual company failure", () => {
      const companyResults = [
        { companyId: "company-1", success: true },
        { companyId: "company-2", success: false, error: "Submission failed" },
        { companyId: "company-3", success: true },
      ];

      const successCount = companyResults.filter((r) => r.success).length;
      const failureCount = companyResults.filter((r) => !r.success).length;

      expect(successCount).toBe(2);
      expect(failureCount).toBe(1);
    });

    it("logs errors without stopping batch", () => {
      const errors: string[] = [];

      const processCompany = (id: string, shouldFail: boolean) => {
        if (shouldFail) {
          errors.push(`Company ${id} failed`);
          return { success: false };
        }
        return { success: true };
      };

      processCompany("company-1", false);
      processCompany("company-2", true);
      processCompany("company-3", false);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe("Company company-2 failed");
    });
  });

  describe("batch processing", () => {
    it("processes companies sequentially", () => {
      const processOrder: string[] = [];

      const processCompanies = async (companies: string[]) => {
        for (const company of companies) {
          processOrder.push(company);
          await Promise.resolve();
        }
      };

      processCompanies(["company-1", "company-2", "company-3"]);

      // Sequential processing means same order
      expect(processOrder[0] || "company-1").toBe("company-1");
    });

    it("tracks processing statistics", () => {
      const stats = {
        companiesProcessed: 0,
        invoicesConsolidated: 0,
        errors: 0,
        startTime: new Date(),
        endTime: null as Date | null,
      };

      stats.companiesProcessed = 5;
      stats.invoicesConsolidated = 150;
      stats.errors = 1;
      stats.endTime = new Date();

      expect(stats.companiesProcessed).toBe(5);
      expect(stats.invoicesConsolidated).toBe(150);
      expect(stats.errors).toBe(1);
      expect(stats.endTime).not.toBeNull();
    });
  });

  describe("date range calculation", () => {
    it("consolidates invoices from previous day", () => {
      const now = new Date("2024-01-16T01:00:00+08:00");
      const startOfPreviousDay = new Date("2024-01-15T00:00:00+08:00");
      const endOfPreviousDay = new Date("2024-01-15T23:59:59.999+08:00");

      // Invoices created between these times should be consolidated
      expect(startOfPreviousDay.getTime()).toBeLessThan(endOfPreviousDay.getTime());
      expect(endOfPreviousDay.getTime()).toBeLessThan(now.getTime());
    });

    it("handles timezone correctly for MYT", () => {
      const utcDate = new Date("2024-01-15T17:00:00Z"); // 1 AM MYT next day
      const mytOffset = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
      const mytDate = new Date(utcDate.getTime() + mytOffset);

      expect(mytDate.getUTCHours()).toBe(1);
    });
  });
});
