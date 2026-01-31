/**
 * Normalizer Unit Tests
 *
 * Tests for the request normalizer that converts client's original Postman format
 * to the internal HashLHDN format.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeCustomerToBuyer,
  normalizeItem,
  normalizeInvoice,
  detectInvoiceType,
  normalizeRequest,
  validateNormalizedRequest,
  type OriginalCustomer,
  type OriginalItem,
  type OriginalInvoice,
  type OriginalRequest,
} from "../../src/adapters/hashlhdn/normalizer.js";

describe("normalizer", () => {
  describe("normalizeCustomerToBuyer", () => {
    it("converts PascalCase customer fields to camelCase buyer fields", () => {
      const customer: OriginalCustomer = {
        Tin: "C25235029040",
        Name: "Test Company Sdn Bhd",
        Address1: "123 Main Street",
        PostalCode: "50000",
        City: "Kuala Lumpur",
        StateCode: "14",
        Telephone: "0123456789",
        Email: "test@example.com",
        IdType: "BRN",
        IdValue: "201901012345",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.tin).toBe("C25235029040");
      expect(buyer.name).toBe("Test Company Sdn Bhd");
      expect(buyer.address).toBe("123 Main Street");
      expect(buyer.postalCode).toBe("50000");
      expect(buyer.city).toBe("Kuala Lumpur");
      expect(buyer.state).toBe("14");
      expect(buyer.phone).toBe("0123456789");
      expect(buyer.email).toBe("test@example.com");
      expect(buyer.idType).toBe("BRN");
      expect(buyer.idValue).toBe("201901012345");
      expect(buyer.country).toBe("MYS");
    });

    it("also accepts camelCase fields", () => {
      const customer: OriginalCustomer = {
        tin: "C25235029040",
        name: "Test Company",
        address: "123 Main Street",
        postalCode: "50000",
        city: "KL",
        state: "14",
        phone: "0123456789",
        idType: "BRN",
        idValue: "201901012345",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.tin).toBe("C25235029040");
      expect(buyer.name).toBe("Test Company");
      expect(buyer.idType).toBe("BRN");
    });

    it("prefers PascalCase when both are present", () => {
      const customer: OriginalCustomer = {
        Name: "PascalCase Name",
        name: "camelCase name",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.name).toBe("PascalCase Name");
    });

    it("handles customerIcNo for NRIC fallback", () => {
      const customer: OriginalCustomer = {
        Name: "John Doe",
        IdType: "NRIC",
        customerIcNo: "801025145127",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.idType).toBe("NRIC");
      expect(buyer.idValue).toBe("801025145127");
    });

    it("prefers idValue over customerIcNo", () => {
      const customer: OriginalCustomer = {
        Name: "John Doe",
        IdType: "NRIC",
        IdValue: "primary-value",
        customerIcNo: "fallback-value",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.idValue).toBe("primary-value");
    });

    it("returns empty name if not provided", () => {
      const customer: OriginalCustomer = {};

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.name).toBe("");
    });
  });

  describe("normalizeItem", () => {
    it("normalizes invoice item with defaults", () => {
      const item: OriginalItem = {
        description: "Test Product",
        quantity: 2,
        unitPrice: 100,
        taxCode: "01",
        taxRate: 8,
        taxAmount: 16,
        total: 216,
      };

      const normalized = normalizeItem(item);

      expect(normalized.description).toBe("Test Product");
      expect(normalized.quantity).toBe(2);
      expect(normalized.unitPrice).toBe(100);
      expect(normalized.taxCode).toBe("01");
      expect(normalized.taxRate).toBe(8);
      expect(normalized.taxAmount).toBe(16);
      expect(normalized.total).toBe(216);
      expect(normalized.discount).toBe(0);
    });

    it("applies default tax code 06 when not provided", () => {
      const item: OriginalItem = {
        description: "Product",
        quantity: 1,
        unitPrice: 100,
      };

      const normalized = normalizeItem(item);

      expect(normalized.taxCode).toBe("06");
    });

    it("applies default quantity 1 when not provided", () => {
      const item: OriginalItem = {
        description: "Product",
        unitPrice: 100,
      };

      const normalized = normalizeItem(item);

      expect(normalized.quantity).toBe(1);
    });
  });

  describe("normalizeInvoice", () => {
    it("normalizes invoice with customer object", () => {
      const invoice: OriginalInvoice = {
        invoiceNumber: "INV-001",
        invoiceDate: "2026-01-20T10:00:00Z",
        amount: 1000,
        taxAmount: 80,
        total: 1080,
        customer: {
          Name: "Test Company",
          IdType: "BRN",
          IdValue: "12345",
        },
        items: [
          {
            description: "Product A",
            quantity: 1,
            unitPrice: 1000,
            taxCode: "01",
            taxRate: 8,
            taxAmount: 80,
            total: 1080,
          },
        ],
      };

      const normalized = normalizeInvoice(invoice);

      expect(normalized.invoiceNumber).toBe("INV-001");
      // P2-10: Date is now normalized to ISO format with milliseconds
      expect(normalized.invoiceDate).toBe("2026-01-20T10:00:00.000Z");
      expect(normalized.amount).toBe(1000);
      expect(normalized.buyer?.name).toBe("Test Company");
      expect(normalized.buyer?.idType).toBe("BRN");
      expect(normalized.items).toHaveLength(1);
    });

    it("throws when invoiceDate is not provided (P2-10)", () => {
      const invoice: OriginalInvoice = {
        invoiceNumber: "INV-001",
        amount: 1000,
        taxAmount: 80,
        total: 1080,
        items: [{ description: "Product", quantity: 1, unitPrice: 1000 }],
      };

      expect(() => normalizeInvoice(invoice)).toThrow("invoiceDate is required");
    });

    it("accepts buyer instead of customer", () => {
      const invoice: OriginalInvoice = {
        invoiceNumber: "INV-001",
        invoiceDate: "2026-01-20T10:00:00Z",
        amount: 1000,
        taxAmount: 80,
        total: 1080,
        buyer: {
          name: "Buyer Name",
          idType: "BRN",
          idValue: "12345",
        },
        items: [{ description: "Product", quantity: 1, unitPrice: 1000 }],
      };

      const normalized = normalizeInvoice(invoice);

      expect(normalized.buyer?.name).toBe("Buyer Name");
    });

    it("prefers customer over buyer if both present", () => {
      const invoice: OriginalInvoice = {
        invoiceNumber: "INV-001",
        invoiceDate: "2026-01-20T10:00:00Z",
        amount: 1000,
        taxAmount: 80,
        total: 1080,
        customer: { Name: "Customer Name" },
        buyer: { name: "Buyer Name" },
        items: [{ description: "Product", quantity: 1, unitPrice: 1000 }],
      };

      const normalized = normalizeInvoice(invoice);

      expect(normalized.buyer?.name).toBe("Customer Name");
    });
  });

  describe("detectInvoiceType", () => {
    it("returns consolidate when ConsolidatedInvoice flag is true", () => {
      const request: OriginalRequest = {
        CompanyId: "company-1",
        ConsolidatedInvoice: true,
        invoices: [
          {
            invoiceNumber: "INV-001",
            amount: 100,
            taxAmount: 8,
            total: 108,
            customer: { IdType: "BRN", IdValue: "12345" },
            items: [],
          },
        ],
      };

      expect(detectInvoiceType(request)).toBe("consolidate");
    });

    it("returns consolidate when consolidatedInvoice (camelCase) flag is true", () => {
      const request: OriginalRequest = {
        companyId: "company-1",
        consolidatedInvoice: true,
        invoices: [
          {
            invoiceNumber: "INV-001",
            amount: 100,
            taxAmount: 8,
            total: 108,
            items: [],
          },
        ],
      };

      expect(detectInvoiceType(request)).toBe("consolidate");
    });

    it("returns justsave when SaveInvoice flag is true", () => {
      const request: OriginalRequest = {
        CompanyId: "company-1",
        SaveInvoice: true,
        invoices: [
          {
            invoiceNumber: "INV-001",
            amount: 100,
            taxAmount: 8,
            total: 108,
            items: [],
          },
        ],
      };

      expect(detectInvoiceType(request)).toBe("justsave");
    });

    it("returns personal when IdType is NRIC", () => {
      const request: OriginalRequest = {
        CompanyId: "company-1",
        invoices: [
          {
            invoiceNumber: "INV-001",
            amount: 100,
            taxAmount: 8,
            total: 108,
            customer: {
              Name: "John Doe",
              IdType: "NRIC",
              IdValue: "801025145127",
            },
            items: [],
          },
        ],
      };

      expect(detectInvoiceType(request)).toBe("personal");
    });

    it("returns buyer when IdType is BRN", () => {
      const request: OriginalRequest = {
        CompanyId: "company-1",
        invoices: [
          {
            invoiceNumber: "INV-001",
            amount: 100,
            taxAmount: 8,
            total: 108,
            customer: {
              Tin: "C25235029040",
              Name: "Test Company",
              IdType: "BRN",
              IdValue: "201901012345",
            },
            items: [],
          },
        ],
      };

      expect(detectInvoiceType(request)).toBe("buyer");
    });

    it("returns consolidate when no customer is present (anonymous B2C)", () => {
      const request: OriginalRequest = {
        CompanyId: "company-1",
        invoices: [
          {
            invoiceNumber: "INV-001",
            amount: 100,
            taxAmount: 8,
            total: 108,
            items: [],
          },
        ],
      };

      expect(detectInvoiceType(request)).toBe("consolidate");
    });

    it("returns consolidate for unknown IdType", () => {
      const request: OriginalRequest = {
        CompanyId: "company-1",
        invoices: [
          {
            invoiceNumber: "INV-001",
            amount: 100,
            taxAmount: 8,
            total: 108,
            customer: {
              Name: "Unknown Type",
              IdType: "PASSPORT",
              IdValue: "A12345678",
            },
            items: [],
          },
        ],
      };

      expect(detectInvoiceType(request)).toBe("consolidate");
    });

    it("prioritizes ConsolidatedInvoice flag over customer IdType", () => {
      const request: OriginalRequest = {
        CompanyId: "company-1",
        ConsolidatedInvoice: true,
        invoices: [
          {
            invoiceNumber: "INV-001",
            amount: 100,
            taxAmount: 8,
            total: 108,
            customer: {
              IdType: "BRN",
              IdValue: "12345",
            },
            items: [],
          },
        ],
      };

      // ConsolidatedInvoice flag should take precedence
      expect(detectInvoiceType(request)).toBe("consolidate");
    });
  });

  describe("normalizeRequest", () => {
    it("normalizes a complete request with PascalCase fields", () => {
      const request: OriginalRequest = {
        CompanyId: "company-123",
        documentVersion: "1.1",
        invoices: [
          {
            invoiceNumber: "INV-001",
            invoiceDate: "2026-01-20T10:00:00Z",
            amount: 1000,
            taxAmount: 80,
            total: 1080,
            customer: {
              Tin: "C25235029040",
              Name: "Test Company",
              IdType: "BRN",
              IdValue: "201901012345",
            },
            items: [
              {
                description: "Product A",
                quantity: 1,
                unitPrice: 1000,
                taxCode: "01",
                taxRate: 8,
                taxAmount: 80,
                total: 1080,
              },
            ],
          },
        ],
      };

      const normalized = normalizeRequest(request);

      expect(normalized.type).toBe("buyer");
      expect(normalized.companyId).toBe("company-123");
      expect(normalized.documentVersion).toBe("1.1");
      expect(normalized.invoices).toHaveLength(1);
      expect(normalized.invoices[0].buyer?.tin).toBe("C25235029040");
    });

    it("uses companyId when CompanyId is not provided", () => {
      const request: OriginalRequest = {
        companyId: "company-456",
        invoices: [
          {
            invoiceNumber: "INV-001",
            invoiceDate: "2026-01-20T10:00:00Z",
            amount: 100,
            taxAmount: 8,
            total: 108,
            items: [],
          },
        ],
      };

      const normalized = normalizeRequest(request);

      expect(normalized.companyId).toBe("company-456");
    });

    it("defaults to document version 1.1", () => {
      const request: OriginalRequest = {
        CompanyId: "company-1",
        invoices: [
          {
            invoiceNumber: "INV-001",
            invoiceDate: "2026-01-20T10:00:00Z",
            amount: 100,
            taxAmount: 8,
            total: 108,
            items: [],
          },
        ],
      };

      const normalized = normalizeRequest(request);

      expect(normalized.documentVersion).toBe("1.1");
    });
  });

  describe("validateNormalizedRequest", () => {
    it("returns valid for a complete request", () => {
      const normalized = {
        type: "buyer" as const,
        companyId: "company-1",
        documentVersion: "1.1" as const,
        invoices: [
          {
            invoiceNumber: "INV-001",
            invoiceDate: "2026-01-20T10:00:00Z",
            amount: 1000,
            discount: 0,
            rounding: 0,
            taxAmount: 80,
            total: 1080,
            currency: "MYR",
            buyer: {
              tin: "C25235029040",
              name: "Test Company",
              idType: "BRN" as const,
              idValue: "201901012345",
              country: "MYS",
            },
            items: [
              {
                description: "Product",
                quantity: 1,
                unitPrice: 1000,
                discount: 0,
                taxCode: "01" as const,
                taxRate: 8,
                taxAmount: 80,
                total: 1080,
              },
            ],
          },
        ],
      };

      const result = validateNormalizedRequest(normalized);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns error for missing companyId", () => {
      const normalized = {
        type: "consolidate" as const,
        companyId: "",
        documentVersion: "1.1" as const,
        invoices: [
          {
            invoiceNumber: "INV-001",
            invoiceDate: "2026-01-20T10:00:00Z",
            amount: 100,
            discount: 0,
            rounding: 0,
            taxAmount: 8,
            total: 108,
            currency: "MYR",
            items: [
              {
                description: "P",
                quantity: 1,
                unitPrice: 100,
                discount: 0,
                taxCode: "06" as const,
                taxRate: 0,
                taxAmount: 0,
                total: 100,
              },
            ],
          },
        ],
      };

      const result = validateNormalizedRequest(normalized);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Company ID is required (CompanyId or companyId)");
    });

    it("returns error for empty invoices", () => {
      const normalized = {
        type: "consolidate" as const,
        companyId: "company-1",
        documentVersion: "1.1" as const,
        invoices: [],
      };

      const result = validateNormalizedRequest(normalized);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("At least one invoice is required");
    });

    it("returns error for buyer type without tin", () => {
      const normalized = {
        type: "buyer" as const,
        companyId: "company-1",
        documentVersion: "1.1" as const,
        invoices: [
          {
            invoiceNumber: "INV-001",
            invoiceDate: "2026-01-20T10:00:00Z",
            amount: 1000,
            discount: 0,
            rounding: 0,
            taxAmount: 80,
            total: 1080,
            currency: "MYR",
            buyer: {
              name: "Test Company",
              idType: "BRN" as const,
              idValue: "201901012345",
              country: "MYS",
            },
            items: [
              {
                description: "Product",
                quantity: 1,
                unitPrice: 1000,
                discount: 0,
                taxCode: "01" as const,
                taxRate: 8,
                taxAmount: 80,
                total: 1080,
              },
            ],
          },
        ],
      };

      const result = validateNormalizedRequest(normalized);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("buyer.tin is required"))).toBe(true);
    });

    it("returns error for personal type without NRIC idType", () => {
      const normalized = {
        type: "personal" as const,
        companyId: "company-1",
        documentVersion: "1.1" as const,
        invoices: [
          {
            invoiceNumber: "INV-001",
            invoiceDate: "2026-01-20T10:00:00Z",
            amount: 100,
            discount: 0,
            rounding: 0,
            taxAmount: 0,
            total: 100,
            currency: "MYR",
            buyer: {
              name: "John Doe",
              idType: "BRN" as const, // Wrong type for personal
              idValue: "801025145127",
              country: "MYS",
            },
            items: [
              {
                description: "Product",
                quantity: 1,
                unitPrice: 100,
                discount: 0,
                taxCode: "06" as const,
                taxRate: 0,
                taxAmount: 0,
                total: 100,
              },
            ],
          },
        ],
      };

      const result = validateNormalizedRequest(normalized);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("must be NRIC for personal invoice"))).toBe(true);
    });
  });
});
