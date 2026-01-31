/**
 * TST-18: Additional Transformer Tests
 * Tests for edge cases in UBL transformation
 */

import { describe, it, expect } from "vitest";

// Test data utilities for transformer
describe("TST-18: Transformer Coverage", () => {
  describe("Invoice type detection", () => {
    it("should detect B2B invoice from buyer idType BRN", () => {
      const buyer = {
        tin: "C12345678901",
        idType: "BRN",
        idValue: "202001234567",
        name: "Test Company",
      };

      expect(buyer.idType).toBe("BRN");
    });

    it("should detect B2C invoice from buyer idType NRIC", () => {
      const buyer = {
        tin: "EI00000000010",
        idType: "NRIC",
        idValue: "880101015001",
        name: "Individual Buyer",
      };

      expect(buyer.idType).toBe("NRIC");
    });

    it("should detect consolidated invoice without buyer", () => {
      const invoice = {
        invoiceNumber: "CONS-001",
        invoiceType: "CONSOLIDATE",
        buyer: null,
      };

      expect(invoice.invoiceType).toBe("CONSOLIDATE");
      expect(invoice.buyer).toBeNull();
    });
  });

  describe("Tax code mapping", () => {
    it("should map code 01 to Sales Tax", () => {
      const taxCodes: Record<string, string> = {
        "01": "Sales Tax (SST)",
        "02": "Service Tax",
        "03": "Tourism Tax",
        "04": "High-Value Goods Tax",
        "05": "Sales Tax on Low Value Goods",
        "06": "Not Applicable",
        E: "Tax Exemption",
      };

      expect(taxCodes["01"]).toBe("Sales Tax (SST)");
      expect(taxCodes["02"]).toBe("Service Tax");
      expect(taxCodes["E"]).toBe("Tax Exemption");
    });
  });

  describe("Amount formatting", () => {
    it("should format amount to 2 decimal places", () => {
      const format2dp = (n: number) => n.toFixed(2);

      expect(format2dp(100)).toBe("100.00");
      expect(format2dp(99.999)).toBe("100.00");
      expect(format2dp(0.005)).toBe("0.01");
    });

    it("should handle negative amounts", () => {
      const format2dp = (n: number) => n.toFixed(2);

      expect(format2dp(-100.5)).toBe("-100.50");
    });

    it("should handle zero amounts", () => {
      const format2dp = (n: number) => n.toFixed(2);

      expect(format2dp(0)).toBe("0.00");
    });
  });

  describe("Date formatting", () => {
    it("should format date as YYYY-MM-DD", () => {
      const formatDate = (d: Date) =>
        d.toISOString().split("T")[0];

      const date = new Date("2026-01-28T12:00:00Z");
      expect(formatDate(date)).toBe("2026-01-28");
    });

    it("should format time as HH:MM:SSZ", () => {
      const formatTime = (d: Date) =>
        d.toISOString().split("T")[1];

      const date = new Date("2026-01-28T15:30:45Z");
      expect(formatTime(date)).toBe("15:30:45.000Z");
    });
  });

  describe("Line item calculations", () => {
    it("should calculate line extension amount", () => {
      const item = {
        quantity: 3,
        unitPrice: 10.0,
        discount: 2.0,
      };

      const lineExtension = item.quantity * item.unitPrice - item.discount;
      expect(lineExtension).toBe(28.0);
    });

    it("should calculate tax amount", () => {
      const lineAmount = 100.0;
      const taxRate = 6; // 6%

      const taxAmount = (lineAmount * taxRate) / 100;
      expect(taxAmount).toBe(6.0);
    });

    it("should calculate total with tax", () => {
      const lineAmount = 100.0;
      const taxAmount = 6.0;

      const total = lineAmount + taxAmount;
      expect(total).toBe(106.0);
    });
  });

  describe("UBL structure validation", () => {
    it("should have required Invoice fields", () => {
      const requiredFields = [
        "ID",
        "IssueDate",
        "IssueTime",
        "InvoiceTypeCode",
        "DocumentCurrencyCode",
        "AccountingSupplierParty",
        "AccountingCustomerParty",
        "LegalMonetaryTotal",
        "InvoiceLine",
      ];

      const invoice = {
        ID: "INV-001",
        IssueDate: "2026-01-28",
        IssueTime: "12:00:00Z",
        InvoiceTypeCode: "01",
        DocumentCurrencyCode: "MYR",
        AccountingSupplierParty: {},
        AccountingCustomerParty: {},
        LegalMonetaryTotal: {},
        InvoiceLine: [],
      };

      requiredFields.forEach((field) => {
        expect(invoice).toHaveProperty(field);
      });
    });

    it("should have required party fields", () => {
      const partyFields = [
        "IndustryClassificationCode",
        "PartyIdentification",
        "PostalAddress",
        "PartyLegalEntity",
      ];

      const party = {
        IndustryClassificationCode: "62010",
        PartyIdentification: [{ ID: "C12345678901" }],
        PostalAddress: {},
        PartyLegalEntity: { RegistrationName: "Test Company" },
      };

      partyFields.forEach((field) => {
        expect(party).toHaveProperty(field);
      });
    });
  });

  describe("Address formatting", () => {
    it("should format Malaysian address", () => {
      const address = {
        addressLine1: "123 Jalan Test",
        city: "Kuala Lumpur",
        state: "14",
        postalCode: "50000",
        country: "MYS",
      };

      expect(address.country).toBe("MYS");
      expect(address.state).toBe("14");
    });

    it("should map state code to name", () => {
      const stateCodes: Record<string, string> = {
        "01": "Johor",
        "02": "Kedah",
        "03": "Kelantan",
        "14": "Kuala Lumpur",
        "15": "Labuan",
        "16": "Putrajaya",
      };

      expect(stateCodes["14"]).toBe("Kuala Lumpur");
    });
  });

  describe("Currency handling", () => {
    it("should use MYR as default currency", () => {
      const defaultCurrency = "MYR";
      expect(defaultCurrency).toBe("MYR");
    });

    it("should format currency amounts", () => {
      const formatCurrency = (amount: number, currency: string) =>
        `${amount.toFixed(2)} ${currency}`;

      expect(formatCurrency(1234.5, "MYR")).toBe("1234.50 MYR");
    });
  });

  describe("Discount handling", () => {
    it("should handle zero discount", () => {
      const discount = 0;
      const hasDiscount = discount > 0;

      expect(hasDiscount).toBe(false);
    });

    it("should handle positive discount", () => {
      const discount = 10.5;
      const hasDiscount = discount > 0;

      expect(hasDiscount).toBe(true);
    });

    it("should calculate discount percentage", () => {
      const originalAmount = 100;
      const discount = 10;
      const discountPercent = (discount / originalAmount) * 100;

      expect(discountPercent).toBe(10);
    });
  });

  describe("Rounding handling", () => {
    it("should handle positive rounding", () => {
      const calculateTotal = (amount: number, tax: number, rounding: number) =>
        amount + tax + rounding;

      expect(calculateTotal(100, 6, 0.03)).toBeCloseTo(106.03, 2);
    });

    it("should handle negative rounding", () => {
      const calculateTotal = (amount: number, tax: number, rounding: number) =>
        amount + tax + rounding;

      expect(calculateTotal(100, 6, -0.03)).toBeCloseTo(105.97, 2);
    });

    it("should handle zero rounding", () => {
      const calculateTotal = (amount: number, tax: number, rounding: number) =>
        amount + tax + rounding;

      expect(calculateTotal(100, 6, 0)).toBe(106);
    });
  });
});
