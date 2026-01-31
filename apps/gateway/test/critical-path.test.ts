/**
 * CRITICAL PATH TESTS
 *
 * These tests MUST pass before any deployment.
 * They protect the core POS → Submit → VALID flow from regressions.
 *
 * Run with: pnpm --filter @myinvois/gateway test critical-path
 */

import { describe, it, expect } from "vitest";

// Import transformer functions for UBL validation
import { transformToUBL, type CompanyInfo } from "../src/adapters/klcubelhdn/transformer.js";
import type { Invoice, InvoiceItem } from "../src/adapters/klcubelhdn/schemas.js";

/**
 * Test company data
 */
const testCompany: CompanyInfo = {
  tin: "C00000000000",
  idValue: "202401012345", // BRN
  idType: "BRN",
  name: "Test Company Sdn Bhd",
  address: "123 Test Street",
  city: "Kuala Lumpur",
  state: "14",
  postalCode: "50000",
  country: "MYS",
  phone: "+60123456789",
  email: "test@example.com",
  industryCode: "46510",
  industryName: "Wholesale of computers",
};

/**
 * Test invoice data
 */
const testInvoice: Invoice = {
  invoiceNumber: "TEST-001",
  invoiceDate: "2026-01-27T10:00:00+08:00",
  amount: 100.0,
  discount: 0,
  rounding: 0,
  taxAmount: 6.0,
  total: 106.0,
  currency: "MYR",
  items: [
    {
      description: "Test Item",
      quantity: 1,
      unitPrice: 100.0,
      discount: 0,
      taxCode: "02",
      taxRate: 6,
      taxAmount: 6.0,
      total: 106.0,
    },
  ],
};

describe("Critical Path: UBL Transformation", () => {
  describe("ItemPriceExtension (Bug Fix v1.4.21)", () => {
    it("should use lineExtension (qty * price - discount) NOT item.total", () => {
      const invoice: Invoice = {
        ...testInvoice,
        items: [
          {
            description: "Coffee",
            quantity: 2,
            unitPrice: 10.0,
            discount: 0,
            taxCode: "02",
            taxRate: 6,
            taxAmount: 1.2,
            total: 21.2, // This includes tax!
          },
        ],
      };

      const ubl = transformToUBL([invoice], testCompany, false, "1.1");
      const invoiceContent = (ubl as any).Invoice?.[0];
      const invoiceLine = invoiceContent?.InvoiceLine?.[0];

      // ItemPriceExtension should be qty * unitPrice = 2 * 10 = 20.00
      // NOT item.total which is 21.20 (includes tax)
      const itemPriceExtension = invoiceLine?.ItemPriceExtension?.[0]?.Amount?.[0]?._;
      expect(Number(itemPriceExtension)).toBe(20.0);
      expect(Number(itemPriceExtension)).not.toBe(21.2);
    });

    it("should match LineExtensionAmount", () => {
      const invoice: Invoice = {
        ...testInvoice,
        items: [
          {
            description: "Item with discount",
            quantity: 5,
            unitPrice: 20.0,
            discount: 10.0, // 10 discount
            taxCode: "02",
            taxRate: 6,
            taxAmount: 5.4,
            total: 95.4,
          },
        ],
      };

      const ubl = transformToUBL([invoice], testCompany, false, "1.1");
      const invoiceContent = (ubl as any).Invoice?.[0];
      const invoiceLine = invoiceContent?.InvoiceLine?.[0];

      // LineExtensionAmount = qty * price - discount = 5 * 20 - 10 = 90.00
      const lineExtension = invoiceLine?.LineExtensionAmount?.[0]?._;
      const itemPriceExtension = invoiceLine?.ItemPriceExtension?.[0]?.Amount?.[0]?._;

      expect(Number(lineExtension)).toBe(90.0);
      expect(Number(itemPriceExtension)).toBe(90.0);
      expect(lineExtension).toBe(itemPriceExtension);
    });
  });

  describe("Supplier Identification (Bug Fix v1.4.22 - CF323)", () => {
    it("should use 'NA' when idValue is empty", () => {
      const companyWithoutBRN: CompanyInfo = {
        ...testCompany,
        idValue: "", // Empty BRN
      };

      const ubl = transformToUBL([testInvoice], companyWithoutBRN, false, "1.1");
      const invoiceContent = (ubl as any).Invoice?.[0];
      const supplierParty = invoiceContent?.AccountingSupplierParty?.[0]?.Party?.[0];
      const identifications = supplierParty?.PartyIdentification;

      // Find the BRN identification (second one)
      const brnId = identifications?.[1]?.ID?.[0]?._;
      expect(brnId).toBe("NA");
    });

    it("should use actual idValue when provided", () => {
      const ubl = transformToUBL([testInvoice], testCompany, false, "1.1");
      const invoiceContent = (ubl as any).Invoice?.[0];
      const supplierParty = invoiceContent?.AccountingSupplierParty?.[0]?.Party?.[0];
      const identifications = supplierParty?.PartyIdentification;

      // Find the BRN identification (second one)
      const brnId = identifications?.[1]?.ID?.[0]?._;
      expect(brnId).toBe("202401012345");
    });
  });

  describe("Consolidated Invoice Requirements", () => {
    it("should include InvoicePeriod for consolidated invoices", () => {
      const ubl = transformToUBL([testInvoice], testCompany, true, "1.1");
      const invoiceContent = (ubl as any).Invoice?.[0];

      expect(invoiceContent?.InvoicePeriod).toBeDefined();
      expect(invoiceContent?.InvoicePeriod?.[0]?.StartDate).toBeDefined();
      expect(invoiceContent?.InvoicePeriod?.[0]?.EndDate).toBeDefined();
    });

    it("should use General Public TIN for consolidated invoices", () => {
      const ubl = transformToUBL([testInvoice], testCompany, true, "1.1");
      const invoiceContent = (ubl as any).Invoice?.[0];
      const customerParty = invoiceContent?.AccountingCustomerParty?.[0]?.Party?.[0];
      const customerTin = customerParty?.PartyIdentification?.[0]?.ID?.[0]?._;

      expect(customerTin).toBe("EI00000000010");
    });
  });

  describe("Date/Time Formatting", () => {
    it("should format IssueDate as YYYY-MM-DD", () => {
      const ubl = transformToUBL([testInvoice], testCompany, false, "1.1");
      const invoiceContent = (ubl as any).Invoice?.[0];
      const issueDate = invoiceContent?.IssueDate?.[0]?._;

      expect(issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should format IssueTime as HH:mm:ssZ", () => {
      const ubl = transformToUBL([testInvoice], testCompany, false, "1.1");
      const invoiceContent = (ubl as any).Invoice?.[0];
      const issueTime = invoiceContent?.IssueTime?.[0]?._;

      expect(issueTime).toMatch(/^\d{2}:\d{2}:\d{2}Z$/);
    });
  });
});

describe("Critical Path: Tax Calculations", () => {
  it("should calculate TaxTotal correctly", () => {
    const ubl = transformToUBL([testInvoice], testCompany, false, "1.1");
    const invoiceContent = (ubl as any).Invoice?.[0];
    const taxTotal = invoiceContent?.TaxTotal?.[0]?.TaxAmount?.[0]?._;

    expect(Number(taxTotal)).toBe(6.0);
  });

  it("should calculate LegalMonetaryTotal correctly", () => {
    const invoice: Invoice = {
      ...testInvoice,
      amount: 100.0,
      discount: 5.0,
      taxAmount: 5.7,
      total: 100.7,
    };

    const ubl = transformToUBL([invoice], testCompany, false, "1.1");
    const invoiceContent = (ubl as any).Invoice?.[0];
    const monetaryTotal = invoiceContent?.LegalMonetaryTotal?.[0];

    expect(Number(monetaryTotal?.TaxExclusiveAmount?.[0]?._)).toBe(95.0); // 100 - 5
    expect(Number(monetaryTotal?.PayableAmount?.[0]?._)).toBe(100.7);
  });
});

describe("Critical Path: Required Fields", () => {
  it("should include all mandatory supplier fields", () => {
    const ubl = transformToUBL([testInvoice], testCompany, false, "1.1");
    const invoiceContent = (ubl as any).Invoice?.[0];
    const supplierParty = invoiceContent?.AccountingSupplierParty?.[0]?.Party?.[0];

    expect(supplierParty?.PartyIdentification).toBeDefined();
    expect(supplierParty?.PostalAddress).toBeDefined();
    expect(supplierParty?.PartyLegalEntity).toBeDefined();
    expect(supplierParty?.Contact).toBeDefined();
    expect(supplierParty?.IndustryClassificationCode).toBeDefined();
  });

  it("should include 4 PartyIdentification entries for supplier", () => {
    const ubl = transformToUBL([testInvoice], testCompany, false, "1.1");
    const invoiceContent = (ubl as any).Invoice?.[0];
    const supplierParty = invoiceContent?.AccountingSupplierParty?.[0]?.Party?.[0];
    const identifications = supplierParty?.PartyIdentification;

    // TIN, BRN, SST, TTX
    expect(identifications?.length).toBe(4);
  });
});
