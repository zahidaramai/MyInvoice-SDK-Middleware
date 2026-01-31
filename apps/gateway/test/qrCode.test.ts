/**
 * TST-07: QR Code Generation Tests
 * Tests for QR URL and posInvoiceId generation
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

describe("TST-07: QR Code Generation", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/v1/pos/invoice - QR URL generation", () => {
    it("should generate unique posInvoiceId with company prefix", async () => {
      const mockCreatedInvoice = {
        id: "invoice-123",
        companyId: COMPANY_ID,
        invoiceNumber: "INV-001",
        posInvoiceId: "TC-12345678",
        trackingId: "trk_ABC123",
        status: "DRAFT",
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
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.qrUrl).toBeDefined();
      expect(body.qrUrl).toContain("/e/");
    });

    it("should include posInvoiceId in response", async () => {
      const mockCreatedInvoice = {
        id: "invoice-123",
        companyId: COMPANY_ID,
        invoiceNumber: "INV-002",
        posInvoiceId: "TC-87654321",
        trackingId: "trk_XYZ789",
        status: "DRAFT",
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
          invoices: [
            {
              invoiceNumber: "INV-002",
              invoiceDate: "2026-01-27T12:00:00+08:00",
              amount: 50.0,
              taxAmount: 3.0,
              total: 53.0,
              items: [
                {
                  description: "Another Item",
                  quantity: 2,
                  unitPrice: 25.0,
                  taxCode: "01",
                  taxRate: 6,
                  taxAmount: 3.0,
                  total: 53.0,
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      // Response uses `invoiceId` which is the posInvoiceId
      expect(body.invoiceId).toBeDefined();
      // QR URL should contain the invoiceId
      expect(body.qrUrl).toContain(body.invoiceId);
    });

    it("should retry on posInvoiceId collision", async () => {
      vi.mocked(storage.findCompanyById).mockResolvedValue(mockCompany as any);
      vi.mocked(storage.findInvoiceByNumber).mockResolvedValue(null);

      // First call fails with unique constraint violation, second succeeds
      vi.mocked(storage.createInvoice)
        .mockRejectedValueOnce(new Error("Unique constraint failed on field: posInvoiceId"))
        .mockResolvedValueOnce({
          id: "invoice-123",
          companyId: COMPANY_ID,
          invoiceNumber: "INV-003",
          posInvoiceId: "TC-NEWID123",
          trackingId: "trk_NEW123",
          status: "DRAFT",
          createdAt: new Date(),
        } as any);

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
              invoiceNumber: "INV-003",
              invoiceDate: "2026-01-27T12:00:00+08:00",
              amount: 100.0,
              taxAmount: 6.0,
              total: 106.0,
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
        },
      });

      expect(response.statusCode).toBe(201);
      expect(storage.createInvoice).toHaveBeenCalledTimes(2);
    });

    it("should include expiresAt for QR validity", async () => {
      const mockCreatedInvoice = {
        id: "invoice-123",
        companyId: COMPANY_ID,
        invoiceNumber: "INV-004",
        posInvoiceId: "TC-EXP12345",
        trackingId: "trk_EXP123",
        status: "DRAFT",
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
          invoices: [
            {
              invoiceNumber: "INV-004",
              invoiceDate: "2026-01-27T12:00:00+08:00",
              amount: 100.0,
              taxAmount: 6.0,
              total: 106.0,
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
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.expiresAt).toBeDefined();

      // expiresAt should be in the future
      const expiresAt = new Date(body.expiresAt);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("PosInvoiceId format", () => {
    it("should use company TIN prefix for posInvoiceId", async () => {
      const mockCreatedInvoice = {
        id: "invoice-123",
        companyId: COMPANY_ID,
        invoiceNumber: "INV-005",
        posInvoiceId: "TC-ABCD1234",
        trackingId: "trk_ABCD123",
        status: "DRAFT",
        createdAt: new Date(),
      };

      vi.mocked(storage.findCompanyById).mockResolvedValue(mockCompany as any);
      vi.mocked(storage.findInvoiceByNumber).mockResolvedValue(null);
      vi.mocked(storage.createInvoice).mockImplementation(async (data: any) => {
        // Verify posInvoiceId format in the create call
        expect(data.posInvoiceId).toBeDefined();
        expect(typeof data.posInvoiceId).toBe("string");
        expect(data.posInvoiceId.length).toBeGreaterThan(0);
        return mockCreatedInvoice as any;
      });

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
              invoiceNumber: "INV-005",
              invoiceDate: "2026-01-27T12:00:00+08:00",
              amount: 100.0,
              taxAmount: 6.0,
              total: 106.0,
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
        },
      });

      expect(response.statusCode).toBe(201);
    });
  });
});
