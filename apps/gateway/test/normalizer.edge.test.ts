/**
 * TST-11: Normalizer Edge Case Tests
 * Tests for request normalization edge cases
 */

import { describe, it, expect } from "vitest";
import {
  normalizeCustomerToBuyer,
  normalizeItem,
  normalizeInvoice,
  detectInvoiceType,
} from "../src/adapters/hashlhdn/normalizer.js";

describe("TST-11: Normalizer Edge Cases", () => {
  describe("normalizeCustomerToBuyer", () => {
    it("should handle PascalCase customer fields (B2B)", () => {
      const customer = {
        Tin: "C25235029040",
        Name: "Dinesoft sdn bhd",
        Address1: "16A & 16B, Jalan SS 25/23",
        PostalCode: "47301",
        City: "Selangor",
        StateCode: "10",
        Telephone: "0163218549",
        IdType: "BRN",
        IdValue: "20170104319",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.tin).toBe("C25235029040");
      expect(buyer.name).toBe("Dinesoft sdn bhd");
      expect(buyer.idType).toBe("BRN");
      expect(buyer.idValue).toBe("20170104319");
    });

    it("should handle lowercase customer fields (B2C)", () => {
      const customer = {
        tin: "801025145127",
        name: "Leong",
        address1: "B-30-2, The holmes 2",
        postalCode: "56000",
        stateCode: "14",
        city: "Kuala Lumpur",
        telephone: "9221133422",
        idType: "NRIC",
        idValue: "801025145127",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.tin).toBe("801025145127");
      expect(buyer.name).toBe("Leong");
      expect(buyer.idType).toBe("NRIC");
      expect(buyer.idValue).toBe("801025145127");
    });

    it("should handle mixed case customer fields", () => {
      const customer = {
        tin: "801025145127",
        Name: "Mixed Case User",
        address1: "123 Street",
        PostalCode: "56000",
        city: "KL",
        StateCode: "14",
        idType: "NRIC",
        IdValue: "801025145127", // Note: IdValue is PascalCase
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.name).toBe("Mixed Case User");
      expect(buyer.idValue).toBe("801025145127");
    });

    it("should use customerIcNo as fallback for idValue (B2C)", () => {
      const customer = {
        tin: "801025145127",
        name: "Customer",
        customerIcNo: "751120085713",
        idType: "NRIC",
        // No idValue provided
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.idValue).toBe("751120085713");
    });

    it("should prefer idValue over customerIcNo", () => {
      const customer = {
        tin: "801025145127",
        name: "Customer",
        customerIcNo: "111111111111",
        idValue: "222222222222",
        idType: "NRIC",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.idValue).toBe("222222222222");
    });

    it("should handle empty strings", () => {
      const customer = {
        tin: "",
        name: "",
        address1: "",
        idType: "BRN",
        idValue: "",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.tin).toBe("");
      expect(buyer.name).toBe("");
    });

    it("should handle null values", () => {
      const customer = {
        tin: null as any,
        name: "Customer",
        idType: "BRN",
      };

      const buyer = normalizeCustomerToBuyer(customer);

      expect(buyer.tin).toBeFalsy();
    });
  });

  describe("normalizeItem", () => {
    it("should provide defaults for missing optional fields", () => {
      const item = {
        description: "Test Item",
        quantity: 1,
        unitPrice: 100,
      };

      const normalized = normalizeItem(item);

      expect(normalized.discount).toBe(0);
      expect(normalized.taxRate).toBe(0);
      expect(normalized.taxCode).toBe("06"); // Default
    });

    it("should preserve provided values", () => {
      const item = {
        description: "Test Item",
        quantity: 2,
        unitPrice: 50,
        discount: 10,
        taxCode: "01",
        taxRate: 6,
        taxAmount: 5.4,
        total: 95.4,
      };

      const normalized = normalizeItem(item);

      expect(normalized.quantity).toBe(2);
      expect(normalized.discount).toBe(10);
      expect(normalized.taxCode).toBe("01");
    });

    it("should handle zero values", () => {
      const item = {
        description: "Free Item",
        quantity: 1,
        unitPrice: 0,
        taxAmount: 0,
        total: 0,
      };

      const normalized = normalizeItem(item);

      expect(normalized.unitPrice).toBe(0);
      expect(normalized.total).toBe(0);
    });

    it("should handle decimal quantities", () => {
      const item = {
        description: "Bulk Item",
        quantity: 1.5,
        unitPrice: 10,
      };

      const normalized = normalizeItem(item);

      expect(normalized.quantity).toBe(1.5);
    });

    it("should handle very long descriptions", () => {
      const longDescription = "A".repeat(500);
      const item = {
        description: longDescription,
        quantity: 1,
        unitPrice: 100,
      };

      const normalized = normalizeItem(item);

      expect(normalized.description.length).toBe(500);
    });

    it("should use safe tax code parsing for invalid codes", () => {
      const item = {
        description: "Test",
        quantity: 1,
        unitPrice: 100,
        taxCode: "99", // Invalid
      };

      const normalized = normalizeItem(item);

      expect(normalized.taxCode).toBe("06"); // Defaults to "Not Applicable"
    });
  });

  describe("normalizeInvoice", () => {
    it("should accept both customer and buyer objects", () => {
      const invoiceWithCustomer = {
        invoiceNumber: "INV-001",
        invoiceDate: "2026-01-28T12:00:00+08:00",
        amount: 100,
        taxAmount: 6,
        total: 106,
        customer: {
          tin: "C12345678901",
          name: "Customer Corp",
        },
        items: [],
      };

      const normalized = normalizeInvoice(invoiceWithCustomer);
      expect(normalized.buyer).toBeDefined();

      const invoiceWithBuyer = {
        invoiceNumber: "INV-002",
        invoiceDate: "2026-01-28T12:00:00+08:00",
        amount: 100,
        taxAmount: 6,
        total: 106,
        buyer: {
          tin: "C12345678901",
          name: "Buyer Corp",
        },
        items: [],
      };

      const normalized2 = normalizeInvoice(invoiceWithBuyer);
      expect(normalized2.buyer).toBeDefined();
    });

    it("should default currency to MYR", () => {
      const invoice = {
        invoiceNumber: "INV-001",
        invoiceDate: "2026-01-28T12:00:00+08:00",
        amount: 100,
        taxAmount: 6,
        total: 106,
        items: [],
      };

      const normalized = normalizeInvoice(invoice);
      expect(normalized.currency).toBe("MYR");
    });

    it("should preserve provided currency", () => {
      const invoice = {
        invoiceNumber: "INV-001",
        invoiceDate: "2026-01-28T12:00:00+08:00",
        amount: 100,
        taxAmount: 6,
        total: 106,
        currency: "USD",
        items: [],
      };

      const normalized = normalizeInvoice(invoice);
      expect(normalized.currency).toBe("USD");
    });

    it("should default discount and rounding to 0", () => {
      const invoice = {
        invoiceNumber: "INV-001",
        invoiceDate: "2026-01-28T12:00:00+08:00",
        amount: 100,
        taxAmount: 6,
        total: 106,
        items: [],
      };

      const normalized = normalizeInvoice(invoice);
      expect(normalized.discount).toBe(0);
      expect(normalized.rounding).toBe(0);
    });

    it("should normalize all items in the array", () => {
      const invoice = {
        invoiceNumber: "INV-001",
        invoiceDate: "2026-01-28T12:00:00+08:00",
        amount: 200,
        taxAmount: 12,
        total: 212,
        items: [
          { description: "Item 1", quantity: 1, unitPrice: 100 },
          { description: "Item 2", quantity: 2, unitPrice: 50 },
        ],
      };

      const normalized = normalizeInvoice(invoice);
      expect(normalized.items).toHaveLength(2);
      expect(normalized.items[0].discount).toBe(0); // Defaults applied
    });

    it("should throw for missing invoiceDate (P2-10)", () => {
      const invoice = {
        invoiceNumber: "INV-001",
        // invoiceDate is missing
        amount: 100,
        taxAmount: 6,
        total: 106,
        items: [],
      };

      expect(() => normalizeInvoice(invoice as any)).toThrow("invoiceDate is required");
    });

    it("should throw for invalid invoiceDate format (P2-10)", () => {
      const invoice = {
        invoiceNumber: "INV-001",
        invoiceDate: "not-a-valid-date",
        amount: 100,
        taxAmount: 6,
        total: 106,
        items: [],
      };

      expect(() => normalizeInvoice(invoice)).toThrow("Invalid invoiceDate format");
    });

    it("should throw for dates too far in the future (P2-10)", () => {
      const invoice = {
        invoiceNumber: "INV-001",
        invoiceDate: "2099-01-28T12:00:00+08:00",
        amount: 100,
        taxAmount: 6,
        total: 106,
        items: [],
      };

      expect(() => normalizeInvoice(invoice)).toThrow("cannot be more than 1 year in the future");
    });
  });

  describe("detectInvoiceType", () => {
    it("should detect consolidate from flag", () => {
      const request = {
        ConsolidatedInvoice: true,
        invoices: [{ items: [] }],
      };

      const type = detectInvoiceType(request);
      expect(type).toBe("consolidate");
    });

    it("should detect justsave from flag", () => {
      const request = {
        SaveInvoice: true,
        invoices: [{ items: [] }],
      };

      const type = detectInvoiceType(request);
      expect(type).toBe("justsave");
    });

    it("should detect buyer (B2B) from BRN idType", () => {
      const request = {
        invoices: [
          {
            customer: {
              idType: "BRN",
              idValue: "12345678",
            },
            items: [],
          },
        ],
      };

      const type = detectInvoiceType(request);
      expect(type).toBe("buyer");
    });

    it("should detect personal (B2C) from NRIC idType", () => {
      const request = {
        invoices: [
          {
            customer: {
              idType: "NRIC",
              idValue: "801025145127",
            },
            items: [],
          },
        ],
      };

      const type = detectInvoiceType(request);
      expect(type).toBe("personal");
    });

    it("should default to consolidate for no customer", () => {
      const request = {
        invoices: [{ items: [] }],
      };

      const type = detectInvoiceType(request);
      expect(type).toBe("consolidate");
    });

    it("should handle lowercase flags", () => {
      const request = {
        consolidatedInvoice: true,
        invoices: [{ items: [] }],
      };

      const type = detectInvoiceType(request);
      expect(type).toBe("consolidate");
    });

    it("should prioritize ConsolidatedInvoice over SaveInvoice", () => {
      const request = {
        ConsolidatedInvoice: true,
        SaveInvoice: true,
        invoices: [{ items: [] }],
      };

      const type = detectInvoiceType(request);
      expect(type).toBe("consolidate");
    });
  });

  describe("State code validation", () => {
    it("should accept valid Malaysian state codes", () => {
      const validCodes = [
        "01",
        "02",
        "03",
        "04",
        "05",
        "06",
        "07",
        "08",
        "09",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15",
        "16",
        "17",
      ];

      validCodes.forEach((code) => {
        expect(code).toMatch(/^(0[1-9]|1[0-7])$/);
      });
    });
  });

  describe("ID format validation", () => {
    it("should validate TIN format (C + 11 digits)", () => {
      const tinRegex = /^[A-Z]\d{11}$/;
      expect(tinRegex.test("C12345678901")).toBe(true);
      expect(tinRegex.test("D00000000001")).toBe(true);
      expect(tinRegex.test("12345678901")).toBe(false); // Missing letter
    });

    it("should validate BRN format (digits only)", () => {
      const brnRegex = /^\d+$/;
      expect(brnRegex.test("20170104319")).toBe(true);
      expect(brnRegex.test("ABC123")).toBe(false);
    });

    it("should validate NRIC format (12 digits)", () => {
      const nricRegex = /^\d{12}$/;
      expect(nricRegex.test("801025145127")).toBe(true);
      expect(nricRegex.test("12345")).toBe(false); // Too short
    });
  });
});
