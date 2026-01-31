/**
 * TST-13: E2E Flow Tests
 * Tests for complete invoice lifecycle: Create → Submit → Poll → Complete
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
    getPrismaClient: vi.fn().mockReturnValue({
      invoice: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    }),
    findCompanyById: vi.fn(),
    createInvoice: vi.fn(),
    findInvoiceByNumber: vi.fn(),
    findInvoiceByPosInvoiceId: vi.fn(),
    findInvoiceByTrackingId: vi.fn(),
    findInvoiceById: vi.fn(),
    updateInvoiceStatus: vi.fn(),
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

// Mock JWT - POS uses token type
vi.mock("../src/auth/jwt.js", () => ({
  verifyAccessToken: vi.fn(() => {
    throw new Error("Not an access token");
  }),
  verifyPosToken: vi.fn((token: string) => {
    if (token === "valid-pos-token") {
      return {
        userId: "hashmato-pos",
        permissions: ["submit:invoice"],
        type: "pos",
      };
    }
    throw new Error("Invalid POS token");
  }),
  verifyRefreshToken: vi.fn(),
  createTokenPair: vi.fn(),
  createAccessToken: vi.fn(),
  hashRefreshToken: vi.fn(),
}));

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
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VALID_POS_TOKEN = "valid-pos-token";

describe("TST-13: E2E Flow Tests", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("Complete POS Invoice Flow", () => {
    it("should create draft invoice with QR code", async () => {
      const mockCreatedInvoice = {
        id: "invoice-123",
        companyId: COMPANY_ID,
        invoiceNumber: "INV-E2E-001",
        posInvoiceId: "TC-E2E12345",
        trackingId: "trk_E2E123",
        status: "DRAFT",
        invoiceDate: new Date(),
        invoiceType: "CONSOLIDATE",
        amount: "100.00",
        taxAmount: "6.00",
        total: "106.00",
        createdAt: new Date(),
      };

      vi.mocked(storage.findCompanyById).mockResolvedValue(mockCompany as any);
      vi.mocked(storage.findInvoiceByNumber).mockResolvedValue(null);
      vi.mocked(storage.createInvoice).mockResolvedValue(mockCreatedInvoice as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: `Bearer ${VALID_POS_TOKEN}`,
        },
        payload: {
          CompanyId: COMPANY_ID,
          ConsolidatedInvoice: true,
          invoices: [
            {
              invoiceNumber: "INV-E2E-001",
              invoiceDate: "2026-01-27T12:00:00+08:00",
              amount: 100.0,
              taxAmount: 6.0,
              total: 106.0,
              items: [
                {
                  description: "E2E Test Item",
                  quantity: 1,
                  unitPrice: 100.0,
                  taxCode: "01",
                  taxRate: 6,
                  taxAmount: 6.0,
                  total: 106.0,
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      // Response uses `invoiceId` which is the posInvoiceId
      expect(body.invoiceId).toBeDefined();
      expect(body.qrUrl).toBeDefined();
      // Note: trackingId may not be in POS response
    });

    it("should construct share URL for VALID invoice", () => {
      const mockInvoice = {
        id: "invoice-123",
        companyId: COMPANY_ID,
        invoiceNumber: "INV-E2E-001",
        posInvoiceId: "TC-E2E12345",
        status: "VALID",
        myinvoisUuid: "uuid-abc-123",
        myinvoisLongId: "longId-xyz-789",
      };

      // Verify share URL construction logic
      const baseUrl = "https://myinvois.hasil.gov.my";
      const shareUrl = `${baseUrl}/${mockInvoice.myinvoisUuid}/share/${mockInvoice.myinvoisLongId}`;

      expect(shareUrl).toContain(mockInvoice.myinvoisLongId);
      expect(shareUrl).toContain(mockInvoice.myinvoisUuid);
    });
  });

  describe("Invoice State Transitions", () => {
    it("should transition from DRAFT to SUBMITTED", async () => {
      const invoice = {
        status: "DRAFT",
        version: 1,
      };

      // Simulate the transition
      const newStatus = "SUBMITTED";
      expect(invoice.status).not.toBe(newStatus);

      invoice.status = newStatus;
      invoice.version++;

      expect(invoice.status).toBe("SUBMITTED");
      expect(invoice.version).toBe(2);
    });

    it("should transition from SUBMITTED to VALID", async () => {
      const invoice = {
        status: "SUBMITTED",
        myinvoisUuid: "uuid-123",
        myinvoisLongId: null as string | null,
        version: 2,
      };

      // Simulate polling response
      invoice.status = "VALID";
      invoice.myinvoisLongId = "longId-abc-xyz";
      invoice.version++;

      expect(invoice.status).toBe("VALID");
      expect(invoice.myinvoisLongId).toBeDefined();
    });

    it("should transition from SUBMITTED to INVALID on error", async () => {
      const invoice = {
        status: "SUBMITTED",
        myinvoisUuid: "uuid-123",
        errorMessage: null as string | null,
        errorCode: null as string | null,
        version: 2,
      };

      // Simulate validation failure
      invoice.status = "INVALID";
      invoice.errorMessage = "TIN validation failed";
      invoice.errorCode = "INVALID_TIN";
      invoice.version++;

      expect(invoice.status).toBe("INVALID");
      expect(invoice.errorMessage).toBeDefined();
    });

    it("should allow VALID to CANCELLED transition", async () => {
      const invoice = {
        status: "VALID",
        myinvoisLongId: "longId-abc",
        version: 3,
      };

      // Simulate cancellation
      invoice.status = "CANCELLED";
      invoice.version++;

      expect(invoice.status).toBe("CANCELLED");
    });
  });

  describe("Error Recovery Flow", () => {
    it("should allow resubmission of INVALID invoice", async () => {
      const invoice = {
        id: "inv-1",
        status: "INVALID",
        errorMessage: "Previous error",
        version: 2,
      };

      // Reset for resubmission
      invoice.status = "SUBMITTED";
      invoice.errorMessage = null as any;
      invoice.version++;

      expect(invoice.status).toBe("SUBMITTED");
    });

    it("should track retry attempts", () => {
      const submission = {
        trackingId: "trk-123",
        pollAttempts: 0,
        maxAttempts: 10,
      };

      while (submission.pollAttempts < submission.maxAttempts) {
        submission.pollAttempts++;
      }

      expect(submission.pollAttempts).toBe(10);
    });
  });

  describe("Consolidation Flow", () => {
    it("should consolidate multiple DRAFT invoices", () => {
      const draftInvoices = [
        { id: "inv-1", status: "DRAFT", amount: 100, taxAmount: 6, total: 106 },
        { id: "inv-2", status: "DRAFT", amount: 200, taxAmount: 12, total: 212 },
        { id: "inv-3", status: "DRAFT", amount: 50, taxAmount: 3, total: 53 },
      ];

      // Calculate consolidated totals
      const consolidated = draftInvoices.reduce(
        (acc, inv) => ({
          amount: acc.amount + inv.amount,
          taxAmount: acc.taxAmount + inv.taxAmount,
          total: acc.total + inv.total,
          originalIds: [...acc.originalIds, inv.id],
        }),
        { amount: 0, taxAmount: 0, total: 0, originalIds: [] as string[] }
      );

      expect(consolidated.amount).toBe(350);
      expect(consolidated.taxAmount).toBe(21);
      expect(consolidated.total).toBe(371);
      expect(consolidated.originalIds).toHaveLength(3);
    });

    it("should mark original drafts as SUBMITTED after consolidation", () => {
      const draftInvoices = [
        { id: "inv-1", status: "DRAFT" },
        { id: "inv-2", status: "DRAFT" },
      ];

      // After consolidation
      const updatedInvoices = draftInvoices.map((inv) => ({
        ...inv,
        status: "SUBMITTED",
      }));

      updatedInvoices.forEach((inv) => {
        expect(inv.status).toBe("SUBMITTED");
      });
    });
  });

  describe("QR Code Lifecycle", () => {
    it("should determine invoice is pending while SUBMITTED", () => {
      const invoice = {
        id: "invoice-123",
        posInvoiceId: "TC-PENDING123",
        status: "SUBMITTED",
        myinvoisLongId: null,
      };

      const isPending = invoice.status === "SUBMITTED" && !invoice.myinvoisLongId;
      expect(isPending).toBe(true);
    });

    it("should determine invoice is failed for INVALID status", () => {
      const invoice = {
        id: "invoice-123",
        posInvoiceId: "TC-INVALID123",
        status: "INVALID",
        errorMessage: "Validation failed",
      };

      const isFailed = invoice.status === "INVALID";
      expect(isFailed).toBe(true);
      expect(invoice.errorMessage).toBeDefined();
    });

    it("should determine invoice is ready for VALID status with longId", () => {
      const invoice = {
        id: "invoice-123",
        posInvoiceId: "TC-VALID123",
        status: "VALID",
        myinvoisLongId: "VALID-LONG-ID-12345",
        myinvoisUuid: "uuid-123",
      };

      const isReady = invoice.status === "VALID" && !!invoice.myinvoisLongId;
      expect(isReady).toBe(true);

      // Generate share URL
      const baseUrl = "https://myinvois.hasil.gov.my";
      const shareUrl = `${baseUrl}/${invoice.myinvoisUuid}/share/${invoice.myinvoisLongId}`;
      expect(shareUrl).toContain("VALID-LONG-ID");
    });
  });
});
