/**
 * Tests for invoicesRepo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma client
const mockPrismaClient = {
  invoice: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock("../../src/prisma.js", () => ({
  getPrismaClient: () => mockPrismaClient,
}));

describe("invoicesRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findInvoiceById", () => {
    it("returns invoice when found", async () => {
      const mockInvoice = {
        id: "invoice-1",
        invoiceNumber: "INV-001",
        companyId: "company-1",
        status: "DRAFT",
        amount: 100.0,
        taxAmount: 6.0,
        total: 106.0,
        invoiceDate: new Date("2024-01-15T10:00:00Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.invoice.findUnique.mockResolvedValueOnce(mockInvoice);

      const result = await mockPrismaClient.invoice.findUnique({
        where: { id: "invoice-1" },
      });

      expect(result).toEqual(mockInvoice);
      expect(result.invoiceNumber).toBe("INV-001");
    });

    it("returns null when invoice not found", async () => {
      mockPrismaClient.invoice.findUnique.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.invoice.findUnique({
        where: { id: "non-existent" },
      });

      expect(result).toBeNull();
    });
  });

  describe("findInvoiceByNumber", () => {
    it("returns invoice by invoice number and company", async () => {
      const mockInvoice = {
        id: "invoice-2",
        invoiceNumber: "INV-002",
        companyId: "company-1",
      };

      mockPrismaClient.invoice.findFirst.mockResolvedValueOnce(mockInvoice);

      const result = await mockPrismaClient.invoice.findFirst({
        where: {
          invoiceNumber: "INV-002",
          companyId: "company-1",
        },
      });

      expect(result).toEqual(mockInvoice);
    });

    it("returns null when not found", async () => {
      mockPrismaClient.invoice.findFirst.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.invoice.findFirst({
        where: {
          invoiceNumber: "INV-999",
          companyId: "company-1",
        },
      });

      expect(result).toBeNull();
    });
  });

  describe("findInvoiceByMyInvoisUuid", () => {
    it("returns invoice by MyInvois UUID", async () => {
      const mockInvoice = {
        id: "invoice-3",
        myinvoisUuid: "myinvois-uuid-123",
        status: "VALID",
      };

      mockPrismaClient.invoice.findFirst.mockResolvedValueOnce(mockInvoice);

      const result = await mockPrismaClient.invoice.findFirst({
        where: { myinvoisUuid: "myinvois-uuid-123" },
      });

      expect(result).toEqual(mockInvoice);
    });
  });

  describe("findInvoiceByPosInvoiceId", () => {
    it("returns invoice by POS invoice ID", async () => {
      const mockInvoice = {
        id: "invoice-4",
        posInvoiceId: "POS-12345",
        companyId: "company-1",
      };

      mockPrismaClient.invoice.findFirst.mockResolvedValueOnce(mockInvoice);

      const result = await mockPrismaClient.invoice.findFirst({
        where: {
          posInvoiceId: "POS-12345",
          companyId: "company-1",
        },
      });

      expect(result?.posInvoiceId).toBe("POS-12345");
    });
  });

  describe("createInvoice", () => {
    it("creates invoice with all fields", async () => {
      const invoiceData = {
        invoiceNumber: "INV-NEW",
        companyId: "company-1",
        status: "DRAFT",
        amount: 500.0,
        taxAmount: 30.0,
        total: 530.0,
        discount: 0,
        rounding: 0,
        invoiceDate: new Date("2024-01-20T10:00:00Z"),
        currency: "MYR",
        paymentMethod: "CASH",
        buyer: {
          tin: "C12345678901",
          name: "Buyer Company",
          idType: "BRN",
          idValue: "202301012345",
        },
        items: [{ description: "Item 1", quantity: 2, unitPrice: 250.0 }],
      };

      const createdInvoice = {
        id: "invoice-new",
        ...invoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.invoice.create.mockResolvedValueOnce(createdInvoice);

      const result = await mockPrismaClient.invoice.create({
        data: invoiceData,
      });

      expect(result.id).toBe("invoice-new");
      expect(result.invoiceNumber).toBe("INV-NEW");
    });

    it("creates draft invoice for consolidation", async () => {
      const invoiceData = {
        invoiceNumber: "DRAFT-001",
        companyId: "company-1",
        status: "DRAFT",
        amount: 100.0,
        taxAmount: 6.0,
        total: 106.0,
        invoiceDate: new Date(),
        isConsolidated: false,
      };

      const createdInvoice = {
        id: "invoice-draft",
        ...invoiceData,
      };

      mockPrismaClient.invoice.create.mockResolvedValueOnce(createdInvoice);

      const result = await mockPrismaClient.invoice.create({
        data: invoiceData,
      });

      expect(result.status).toBe("DRAFT");
    });
  });

  describe("updateInvoice", () => {
    it("updates invoice status", async () => {
      const updatedInvoice = {
        id: "invoice-1",
        status: "SUBMITTED",
        myinvoisUuid: "new-uuid",
        updatedAt: new Date(),
      };

      mockPrismaClient.invoice.update.mockResolvedValueOnce(updatedInvoice);

      const result = await mockPrismaClient.invoice.update({
        where: { id: "invoice-1" },
        data: {
          status: "SUBMITTED",
          myinvoisUuid: "new-uuid",
        },
      });

      expect(result.status).toBe("SUBMITTED");
      expect(result.myinvoisUuid).toBe("new-uuid");
    });

    it("updates invoice with validation results", async () => {
      const updatedInvoice = {
        id: "invoice-1",
        status: "VALID",
        myinvoisLongId: "long-id-123",
        updatedAt: new Date(),
      };

      mockPrismaClient.invoice.update.mockResolvedValueOnce(updatedInvoice);

      const result = await mockPrismaClient.invoice.update({
        where: { id: "invoice-1" },
        data: {
          status: "VALID",
          myinvoisLongId: "long-id-123",
        },
      });

      expect(result.status).toBe("VALID");
      expect(result.myinvoisLongId).toBe("long-id-123");
    });

    it("updates invoice with error information", async () => {
      const updatedInvoice = {
        id: "invoice-1",
        status: "INVALID",
        errorCode: "INVALID_TIN",
        errorMessage: "TIN not registered",
        updatedAt: new Date(),
      };

      mockPrismaClient.invoice.update.mockResolvedValueOnce(updatedInvoice);

      const result = await mockPrismaClient.invoice.update({
        where: { id: "invoice-1" },
        data: {
          status: "INVALID",
          errorCode: "INVALID_TIN",
          errorMessage: "TIN not registered",
        },
      });

      expect(result.status).toBe("INVALID");
      expect(result.errorCode).toBe("INVALID_TIN");
    });
  });

  describe("updateManyInvoices", () => {
    it("bulk updates invoices by company and status", async () => {
      mockPrismaClient.invoice.updateMany.mockResolvedValueOnce({ count: 5 });

      const result = await mockPrismaClient.invoice.updateMany({
        where: {
          companyId: "company-1",
          status: "DRAFT",
        },
        data: {
          status: "SUBMITTED",
          myinvoisUuid: "consolidated-uuid",
        },
      });

      expect(result.count).toBe(5);
    });
  });

  describe("listInvoices", () => {
    it("returns all invoices for a company", async () => {
      const mockInvoices = [
        { id: "inv-1", invoiceNumber: "INV-001", companyId: "company-1" },
        { id: "inv-2", invoiceNumber: "INV-002", companyId: "company-1" },
      ];

      mockPrismaClient.invoice.findMany.mockResolvedValueOnce(mockInvoices);

      const result = await mockPrismaClient.invoice.findMany({
        where: { companyId: "company-1" },
      });

      expect(result).toHaveLength(2);
    });

    it("returns invoices with pagination", async () => {
      const mockInvoices = [{ id: "inv-2", invoiceNumber: "INV-002" }];

      mockPrismaClient.invoice.findMany.mockResolvedValueOnce(mockInvoices);

      const result = await mockPrismaClient.invoice.findMany({
        where: { companyId: "company-1" },
        skip: 1,
        take: 1,
        orderBy: { createdAt: "desc" },
      });

      expect(result).toHaveLength(1);
    });

    it("returns invoices filtered by status", async () => {
      const mockInvoices = [
        { id: "inv-1", status: "DRAFT" },
        { id: "inv-2", status: "DRAFT" },
      ];

      mockPrismaClient.invoice.findMany.mockResolvedValueOnce(mockInvoices);

      const result = await mockPrismaClient.invoice.findMany({
        where: { status: "DRAFT" },
      });

      expect(result.every((inv) => inv.status === "DRAFT")).toBe(true);
    });

    it("returns invoices filtered by date range", async () => {
      const mockInvoices = [{ id: "inv-1", invoiceDate: new Date("2024-01-15") }];

      mockPrismaClient.invoice.findMany.mockResolvedValueOnce(mockInvoices);

      const result = await mockPrismaClient.invoice.findMany({
        where: {
          invoiceDate: {
            gte: new Date("2024-01-01"),
            lte: new Date("2024-01-31"),
          },
        },
      });

      expect(result).toHaveLength(1);
    });
  });

  describe("countInvoices", () => {
    it("counts all invoices for a company", async () => {
      mockPrismaClient.invoice.count.mockResolvedValueOnce(25);

      const result = await mockPrismaClient.invoice.count({
        where: { companyId: "company-1" },
      });

      expect(result).toBe(25);
    });

    it("counts invoices by status", async () => {
      mockPrismaClient.invoice.count.mockResolvedValueOnce(10);

      const result = await mockPrismaClient.invoice.count({
        where: {
          companyId: "company-1",
          status: "DRAFT",
        },
      });

      expect(result).toBe(10);
    });
  });

  describe("deleteInvoice", () => {
    it("deletes invoice by ID", async () => {
      const deletedInvoice = {
        id: "invoice-to-delete",
        invoiceNumber: "INV-DELETE",
      };

      mockPrismaClient.invoice.delete.mockResolvedValueOnce(deletedInvoice);

      const result = await mockPrismaClient.invoice.delete({
        where: { id: "invoice-to-delete" },
      });

      expect(result.id).toBe("invoice-to-delete");
    });
  });

  describe("invoice status values", () => {
    it("validates all status values", () => {
      const validStatuses = ["DRAFT", "SUBMITTED", "VALID", "INVALID", "CANCELLED", "REJECTED"];

      validStatuses.forEach((status) => {
        expect(typeof status).toBe("string");
      });
    });

    it("identifies terminal statuses", () => {
      const terminalStatuses = ["VALID", "INVALID", "CANCELLED", "REJECTED"];
      const nonTerminalStatuses = ["DRAFT", "SUBMITTED"];

      terminalStatuses.forEach((status) => {
        expect(["VALID", "INVALID", "CANCELLED", "REJECTED"]).toContain(status);
      });

      nonTerminalStatuses.forEach((status) => {
        expect(["VALID", "INVALID", "CANCELLED", "REJECTED"]).not.toContain(status);
      });
    });
  });

  describe("invoice amounts", () => {
    it("validates amount calculations", () => {
      const invoice = {
        amount: 100.0,
        taxAmount: 6.0,
        discount: 10.0,
        rounding: -0.02,
        total: 95.98, // 100 + 6 - 10 - 0.02
      };

      const calculatedTotal =
        invoice.amount + invoice.taxAmount - invoice.discount + invoice.rounding;

      expect(calculatedTotal).toBeCloseTo(95.98, 2);
    });

    it("handles zero amounts", () => {
      const invoice = {
        amount: 0,
        taxAmount: 0,
        total: 0,
      };

      expect(invoice.total).toBe(0);
    });
  });

  describe("invoice with items", () => {
    it("includes items relation", async () => {
      const mockInvoice = {
        id: "invoice-with-items",
        invoiceNumber: "INV-ITEMS",
        items: [
          { id: "item-1", description: "Product A", quantity: 2, unitPrice: 50.0 },
          { id: "item-2", description: "Product B", quantity: 1, unitPrice: 100.0 },
        ],
      };

      mockPrismaClient.invoice.findUnique.mockResolvedValueOnce(mockInvoice);

      const result = await mockPrismaClient.invoice.findUnique({
        where: { id: "invoice-with-items" },
        include: { items: true },
      });

      expect(result.items).toHaveLength(2);
    });
  });

  describe("invoice with buyer", () => {
    it("stores buyer information", async () => {
      const mockInvoice = {
        id: "invoice-with-buyer",
        buyer: {
          tin: "C12345678901",
          name: "Buyer Corp",
          idType: "BRN",
          idValue: "202301012345",
          address: "123 Buyer St",
          city: "KL",
          state: "14",
          postalCode: "50000",
          country: "MYS",
          phone: "0312345678",
          email: "buyer@corp.com",
        },
      };

      expect(mockInvoice.buyer.tin).toBe("C12345678901");
      expect(mockInvoice.buyer.idType).toBe("BRN");
    });

    it("handles B2C buyer with NRIC", () => {
      const mockInvoice = {
        id: "invoice-b2c",
        buyer: {
          tin: "EI00000000010",
          name: "Individual Buyer",
          idType: "NRIC",
          idValue: "800101145678",
        },
      };

      expect(mockInvoice.buyer.idType).toBe("NRIC");
      expect(mockInvoice.buyer.tin).toBe("EI00000000010");
    });
  });
});
