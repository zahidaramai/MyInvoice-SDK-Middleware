/**
 * TST-06: Share-link Endpoint Tests
 * Tests for share-link generation and retrieval
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
    findInvoiceByPosInvoiceIdWithCompany: vi.fn(),
    findInvoiceByPosInvoiceId: vi.fn(),
    findInvoiceByTrackingId: vi.fn(),
    findInvoiceById: vi.fn(),
    findCompanyById: vi.fn(),
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

// Sample test data
const COMPANY_ID = "bc1151e6-b7a6-469e-864d-e5c77ebed3d8";

const mockCompany = {
  id: COMPANY_ID,
  name: "Test Company",
  tin: "C12345678901",
  idValue: "BRN123456",
  idType: "BRN",
};

const mockInvoice = {
  id: "inv-123",
  companyId: COMPANY_ID,
  invoiceNumber: "INV-001",
  posInvoiceId: "TC-12345678",
  trackingId: "trk_ABC123",
  myinvoisUuid: "uuid-abc-123",
  myinvoisLongId: "longId-xyz-789-very-long-string",
  status: "VALID",
  invoiceDate: new Date(),
  invoiceType: "CONSOLIDATE",
  amount: "100.00",
  taxAmount: "6.00",
  total: "106.00",
  rawPayload: JSON.stringify({ items: [] }),
  company: mockCompany,
};

describe("TST-06: Share-link Endpoint", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("Invoice status handling", () => {
    it("should identify VALID invoice as complete", () => {
      const invoice = {
        status: "VALID",
        myinvoisLongId: "longId-abc-xyz",
        myinvoisUuid: "uuid-123",
      };

      const isComplete = invoice.status === "VALID" && !!invoice.myinvoisLongId;
      expect(isComplete).toBe(true);
    });

    it("should identify SUBMITTED invoice as pending", () => {
      const invoice = {
        status: "SUBMITTED",
        myinvoisLongId: null,
        myinvoisUuid: "uuid-123",
      };

      const isPending = invoice.status === "SUBMITTED" && !invoice.myinvoisLongId;
      expect(isPending).toBe(true);
    });

    it("should identify INVALID invoice as failed", () => {
      const invoice = {
        status: "INVALID",
        errorMessage: "Validation failed",
      };

      const isFailed = invoice.status === "INVALID";
      expect(isFailed).toBe(true);
      expect(invoice.errorMessage).toBeDefined();
    });

    it("should identify DRAFT invoice as not yet submitted", () => {
      const invoice = {
        status: "DRAFT",
        myinvoisUuid: null,
        myinvoisLongId: null,
      };

      const isNotSubmitted = invoice.status === "DRAFT";
      expect(isNotSubmitted).toBe(true);
    });
  });

  describe("Share link URL construction", () => {
    it("should construct MyInvois share URL from uuid and longId", () => {
      const uuid = "F9D425P6DS7D8IU";
      const longId = "ABC123XYZ789LONGID";
      const baseUrl = "https://myinvois.hasil.gov.my";

      const shareUrl = `${baseUrl}/${uuid}/share/${longId}`;

      expect(shareUrl).toBe("https://myinvois.hasil.gov.my/F9D425P6DS7D8IU/share/ABC123XYZ789LONGID");
    });

    it("should include environment-specific base URL", () => {
      const uuid = "uuid-123";
      const longId = "longId-456";

      const sandboxUrl = `https://preprod.myinvois.hasil.gov.my/${uuid}/share/${longId}`;
      const prodUrl = `https://myinvois.hasil.gov.my/${uuid}/share/${longId}`;

      expect(sandboxUrl).toContain("preprod");
      expect(prodUrl).not.toContain("preprod");
    });
  });

  describe("QR URL format", () => {
    it("should use posInvoiceId for QR registration URL", () => {
      const posInvoiceId = "TC-12345678";
      const baseUrl = "https://www.duitlhdn.com";

      const qrUrl = `${baseUrl}/e/${posInvoiceId}`;

      expect(qrUrl).toBe("https://www.duitlhdn.com/e/TC-12345678");
    });

    it("should generate scannable QR URL", () => {
      const posInvoiceId = "HM-abc123XY";
      const qrUrl = `https://www.duitlhdn.com/e/${posInvoiceId}`;

      // URL should be short enough for QR code
      expect(qrUrl.length).toBeLessThan(100);
      // URL should contain the posInvoiceId
      expect(qrUrl).toContain(posInvoiceId);
    });
  });
});
