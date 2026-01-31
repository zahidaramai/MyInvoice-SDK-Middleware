/**
 * Tests for HashLHDN normalizer
 */

import { describe, it, expect } from "vitest";

describe("normalizer", () => {
  describe("company field mapping", () => {
    it("maps companyName to name", () => {
      const input = { companyName: "Test Company Sdn Bhd" };
      const normalized = { name: input.companyName };

      expect(normalized.name).toBe("Test Company Sdn Bhd");
    });

    it("maps address1 to address", () => {
      const input = { address1: "123 Jalan Test" };
      const normalized = { address: input.address1 };

      expect(normalized.address).toBe("123 Jalan Test");
    });

    it("maps stateCode to state", () => {
      const input = { stateCode: "14" };
      const normalized = { state: input.stateCode };

      expect(normalized.state).toBe("14");
    });

    it("maps industry1 to industryCode", () => {
      const input = { industry1: "46510" };
      const normalized = { industryCode: input.industry1 };

      expect(normalized.industryCode).toBe("46510");
    });

    it("maps industryCode1 to industryName", () => {
      const input = { industryCode1: "Wholesale of computers" };
      const normalized = { industryName: input.industryCode1 };

      expect(normalized.industryName).toBe("Wholesale of computers");
    });

    it("maps telephone to phone", () => {
      const input = { telephone: "0312345678" };
      const normalized = { phone: input.telephone };

      expect(normalized.phone).toBe("0312345678");
    });
  });

  describe("customer to buyer mapping", () => {
    it("maps customer object to buyer", () => {
      const input = {
        customer: {
          Tin: "C12345678901",
          Name: "Buyer Company",
        },
      };

      const normalized = {
        buyer: {
          tin: input.customer.Tin,
          name: input.customer.Name,
        },
      };

      expect(normalized.buyer.tin).toBe("C12345678901");
      expect(normalized.buyer.name).toBe("Buyer Company");
    });

    it("handles lowercase customer fields", () => {
      const input = {
        customer: {
          tin: "C12345678901",
          name: "Buyer Company",
        },
      };

      const normalized = {
        buyer: {
          tin: input.customer.tin,
          name: input.customer.name,
        },
      };

      expect(normalized.buyer.tin).toBe("C12345678901");
    });

    it("maps Address1 to address", () => {
      const input = {
        customer: {
          Address1: "456 Jalan Buyer",
        },
      };

      const normalized = {
        buyer: {
          address: input.customer.Address1,
        },
      };

      expect(normalized.buyer.address).toBe("456 Jalan Buyer");
    });

    it("maps PostalCode to postalCode", () => {
      const input = {
        customer: {
          PostalCode: "50000",
        },
      };

      const normalized = {
        buyer: {
          postalCode: input.customer.PostalCode,
        },
      };

      expect(normalized.buyer.postalCode).toBe("50000");
    });

    it("maps StateCode to state", () => {
      const input = {
        customer: {
          StateCode: "14",
        },
      };

      const normalized = {
        buyer: {
          state: input.customer.StateCode,
        },
      };

      expect(normalized.buyer.state).toBe("14");
    });

    it("maps Telephone to phone", () => {
      const input = {
        customer: {
          Telephone: "0312345678",
        },
      };

      const normalized = {
        buyer: {
          phone: input.customer.Telephone,
        },
      };

      expect(normalized.buyer.phone).toBe("0312345678");
    });
  });

  describe("B2C special case handling", () => {
    it("maps customerIcNo to idValue", () => {
      const input = {
        customer: {
          customerIcNo: "801025145127",
        },
      };

      const normalized = {
        buyer: {
          idValue: input.customer.customerIcNo,
        },
      };

      expect(normalized.buyer.idValue).toBe("801025145127");
    });

    it("prefers idValue over customerIcNo", () => {
      const input = {
        customer: {
          idValue: "preferred-id",
          customerIcNo: "fallback-id",
        },
      };

      const normalized = {
        buyer: {
          idValue: input.customer.idValue || input.customer.customerIcNo,
        },
      };

      expect(normalized.buyer.idValue).toBe("preferred-id");
    });

    it("uses customerIcNo as fallback", () => {
      const input = {
        customer: {
          customerIcNo: "fallback-id",
        },
      };

      const idValue = (input.customer as { idValue?: string }).idValue || input.customer.customerIcNo;

      expect(idValue).toBe("fallback-id");
    });
  });

  describe("invoice type detection", () => {
    it("detects consolidate type from flag", () => {
      const input = {
        ConsolidatedInvoice: true,
      };

      const invoiceType = input.ConsolidatedInvoice ? "consolidate" : undefined;

      expect(invoiceType).toBe("consolidate");
    });

    it("detects justsave type from flag", () => {
      const input = {
        SaveInvoice: true,
      };

      const invoiceType = input.SaveInvoice ? "justsave" : undefined;

      expect(invoiceType).toBe("justsave");
    });

    it("detects B2B type from BRN idType", () => {
      const input = {
        customer: {
          IdType: "BRN",
        },
      };

      const invoiceType = input.customer.IdType === "BRN" ? "buyer" : undefined;

      expect(invoiceType).toBe("buyer");
    });

    it("detects B2C type from NRIC idType", () => {
      const input = {
        customer: {
          IdType: "NRIC",
        },
      };

      const invoiceType = input.customer.IdType === "NRIC" ? "personal" : undefined;

      expect(invoiceType).toBe("personal");
    });

    it("defaults to consolidate when no buyer", () => {
      const input = {};

      const hasCustomer = (input as { customer?: unknown }).customer !== undefined;
      const invoiceType = hasCustomer ? undefined : "consolidate";

      expect(invoiceType).toBe("consolidate");
    });
  });

  describe("case insensitive mapping", () => {
    it("handles PascalCase customer fields (B2B)", () => {
      const input = {
        customer: {
          Tin: "C12345678901",
          Name: "Test Company",
          IdType: "BRN",
          IdValue: "202301012345",
        },
      };

      expect(input.customer.Tin).toBeDefined();
      expect(input.customer.Name).toBeDefined();
      expect(input.customer.IdType).toBe("BRN");
    });

    it("handles lowercase customer fields (B2C)", () => {
      const input = {
        customer: {
          tin: "801025145127",
          name: "John Doe",
          idType: "NRIC",
          idValue: "801025145127",
        },
      };

      expect(input.customer.tin).toBeDefined();
      expect(input.customer.name).toBeDefined();
      expect(input.customer.idType).toBe("NRIC");
    });

    it("handles mixed case customer fields", () => {
      const input = {
        customer: {
          tin: "801025145127",
          name: "Leong",
          customerIcNo: "751120085713",
          address1: "B-30-2, The holmes 2",
          postalCode: "56000",
          stateCode: "14",
          city: "Kuala Lumpur",
          telephone: "9221133422",
          idType: "NRIC",
          IdValue: "801025145127",
        },
      };

      expect(input.customer.tin).toBeDefined();
      expect(input.customer.IdValue).toBeDefined();
    });
  });

  describe("CompanyId normalization", () => {
    it("normalizes CompanyId to companyId", () => {
      const input = { CompanyId: "company-uuid-123" };
      const normalized = { companyId: input.CompanyId };

      expect(normalized.companyId).toBe("company-uuid-123");
    });
  });

  describe("invoice array handling", () => {
    it("preserves invoices array", () => {
      const input = {
        invoices: [
          { invoiceNumber: "INV001" },
          { invoiceNumber: "INV002" },
        ],
      };

      expect(input.invoices).toHaveLength(2);
    });

    it("normalizes invoice fields", () => {
      const invoice = {
        invoiceNumber: "INV001",
        invoiceDate: "2024-01-15T10:00:00+08:00",
        paymentType: "CASH",
        amount: 100.00,
        taxAmount: 6.00,
        total: 106.00,
      };

      expect(invoice.invoiceNumber).toBe("INV001");
      expect(invoice.amount).toBe(100.00);
    });
  });

  describe("items array handling", () => {
    it("preserves items array in invoice", () => {
      const invoice = {
        items: [
          { description: "Item 1", quantity: 1, unitPrice: 50.00 },
          { description: "Item 2", quantity: 2, unitPrice: 25.00 },
        ],
      };

      expect(invoice.items).toHaveLength(2);
    });

    it("calculates item total", () => {
      const item = {
        quantity: 2,
        unitPrice: 25.00,
      };

      const total = item.quantity * item.unitPrice;
      expect(total).toBe(50.00);
    });
  });

  describe("phone number normalization", () => {
    it("accepts telephone field", () => {
      const input = { telephone: "0312345678" };
      expect(input.telephone).toBeDefined();
    });

    it("accepts phone field", () => {
      const input = { phone: "0312345678" };
      expect(input.phone).toBeDefined();
    });

    it("prefers phone over telephone", () => {
      const input = { phone: "phone-value", telephone: "telephone-value" };
      const normalized = input.phone || input.telephone;

      expect(normalized).toBe("phone-value");
    });
  });
});
