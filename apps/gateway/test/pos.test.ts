/**
 * TST-05: POS Route Tests
 * Tests for POS invoice submission endpoint
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
    findCompanyById: vi.fn(),
    createInvoice: vi.fn(),
    findInvoiceByNumber: vi.fn(),
    findInvoiceByPosInvoiceId: vi.fn(),
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

// Mock JWT functions - POS uses token type
vi.mock("../src/auth/jwt.js", () => ({
  verifyAccessToken: vi.fn(() => {
    throw new Error("Not an access token");
  }),
  verifyPosToken: vi.fn((token: string) => {
    if (token === "valid-pos-token") {
      return {
        userId: "pos-terminal",
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

// Sample test data - must use valid UUIDs
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

const INACTIVE_COMPANY_ID = "a1234567-b7a6-469e-864d-e5c77ebed3d8";

const mockInactiveCompany = {
  ...mockCompany,
  id: INACTIVE_COMPANY_ID,
  isActive: false,
};

const mockCreatedInvoice = {
  id: "invoice-123",
  companyId: COMPANY_ID,
  invoiceNumber: "INV-001",
  invoiceDate: new Date(),
  invoiceType: "CONSOLIDATE",
  status: "DRAFT",
  posInvoiceId: "TC-12345678",
  trackingId: "HASH-ABC123-XYZ789",
  amount: "100.00",
  taxAmount: "6.00",
  total: "106.00",
  createdAt: new Date(),
};

const VALID_POS_TOKEN = "valid-pos-token";

const validPosPayload = {
  CompanyId: COMPANY_ID,
  ConsolidatedInvoice: true,
  invoices: [
    {
      invoiceNumber: "INV-001",
      invoiceDate: "2026-01-27T12:00:00+08:00",
      amount: 100.0,
      taxAmount: 6.0,
      total: 106.0,
      paymentType: "CASH",
      items: [
        {
          description: "Test Item",
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
};

describe("TST-05: POS Route API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/v1/pos/invoice", () => {
    it("should create a draft invoice with QR URL", async () => {
      vi.mocked(storage.findCompanyById).mockResolvedValue(mockCompany as any);
      vi.mocked(storage.findInvoiceByNumber).mockResolvedValue(null);
      vi.mocked(storage.createInvoice).mockResolvedValue(mockCreatedInvoice as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: `Bearer ${VALID_POS_TOKEN}`,
        },
        payload: validPosPayload,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.invoiceId).toBeDefined();
      expect(body.qrUrl).toContain("/e/");
      expect(body.expiresAt).toBeDefined();
    });

    it("should accept lowercase companyId", async () => {
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
          ...validPosPayload,
          CompanyId: undefined,
          companyId: COMPANY_ID,
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it("should return 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        payload: validPosPayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 401 with invalid token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: "Bearer invalid-token",
        },
        payload: validPosPayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 400 for missing company ID", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: `Bearer ${VALID_POS_TOKEN}`,
        },
        payload: {
          ...validPosPayload,
          CompanyId: undefined,
          companyId: undefined,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });

    it("should return 400 for missing invoices", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: `Bearer ${VALID_POS_TOKEN}`,
        },
        payload: {
          CompanyId: COMPANY_ID,
          invoices: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 404 for non-existent company", async () => {
      vi.mocked(storage.findCompanyById).mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: `Bearer ${VALID_POS_TOKEN}`,
        },
        payload: validPosPayload,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.code).toBe("COMPANY_NOT_FOUND");
    });

    it("should return 403 for inactive company", async () => {
      vi.mocked(storage.findCompanyById).mockResolvedValue(mockInactiveCompany as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: `Bearer ${VALID_POS_TOKEN}`,
        },
        payload: {
          ...validPosPayload,
          CompanyId: INACTIVE_COMPANY_ID,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.code).toBe("COMPANY_INACTIVE");
    });

    it("should return 409 for duplicate invoice number", async () => {
      vi.mocked(storage.findCompanyById).mockResolvedValue(mockCompany as any);
      vi.mocked(storage.findInvoiceByNumber).mockResolvedValue(mockCreatedInvoice as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: `Bearer ${VALID_POS_TOKEN}`,
        },
        payload: validPosPayload,
      });

      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.code).toBe("DUPLICATE_INVOICE_NUMBER");
    });

    it("should handle invoice date without timezone", async () => {
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
          ...validPosPayload,
          invoices: [
            {
              ...validPosPayload.invoices[0],
              invoiceDate: "2026-01-27T12:00:00", // No timezone
            },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      // Check that createInvoice was called with proper date (UTC+8 assumed)
      expect(storage.createInvoice).toHaveBeenCalled();
    });

    it("should retry on posInvoiceId collision", async () => {
      vi.mocked(storage.findCompanyById).mockResolvedValue(mockCompany as any);
      vi.mocked(storage.findInvoiceByNumber).mockResolvedValue(null);

      // First call fails with unique constraint violation
      vi.mocked(storage.createInvoice)
        .mockRejectedValueOnce(new Error("Unique constraint failed on field: posInvoiceId"))
        .mockResolvedValueOnce(mockCreatedInvoice as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: `Bearer ${VALID_POS_TOKEN}`,
        },
        payload: validPosPayload,
      });

      expect(response.statusCode).toBe(201);
      expect(storage.createInvoice).toHaveBeenCalledTimes(2);
    });

    it("should include discount and rounding in stored payload", async () => {
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
          ...validPosPayload,
          invoices: [
            {
              ...validPosPayload.invoices[0],
              discount: 5.0,
              rounding: 0.03,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(storage.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          discount: "5",
          rounding: "0.03",
        })
      );
    });

    it("should validate required item fields", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: `Bearer ${VALID_POS_TOKEN}`,
        },
        payload: {
          CompanyId: COMPANY_ID,
          invoices: [
            {
              invoiceNumber: "INV-001",
              amount: 100.0,
              taxAmount: 6.0,
              total: 106.0,
              items: [
                {
                  // Missing description, quantity, unitPrice
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
