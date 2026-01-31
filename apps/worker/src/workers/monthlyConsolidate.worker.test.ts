/**
 * Unit tests for monthly consolidation worker logic
 */

import { describe, it, expect } from "vitest";
import {
  consolidateItems,
  calculateTotals,
  type ConsolidatedItem,
} from "./monthlyConsolidate.worker.js";
import type { InvoiceWithCompany } from "@myinvois/storage";

// Helper to create mock invoice
function createMockInvoice(
  id: string,
  items: Array<{
    description: string;
    taxCode: string;
    taxRate: number;
    quantity: number;
    unitPrice: number;
    discount?: number;
    taxAmount: number;
    total: number;
  }>
): InvoiceWithCompany {
  return {
    id,
    companyId: "company-1",
    invoiceNumber: `INV-${id}`,
    posInvoiceId: null,
    invoiceDate: new Date(),
    invoiceType: "CONSOLIDATE",
    status: "DRAFT",
    version: 1, // P1-07: Optimistic locking version
    rawPayload: JSON.stringify({ items }),
    ublPayload: null,
    trackingId: null,
    myinvoisUuid: null,
    myinvoisLongId: null,
    amount: "100",
    discount: "0",
    rounding: "0",
    taxAmount: "6",
    total: "106",
    buyerInfo: null,
    errorMessage: null,
    errorCode: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    company: {
      id: "company-1",
      name: "Test Company",
      tin: "C12345678900",
      idValue: "12345678",
      idType: "BRN",
      address: null,
      city: null,
      state: null,
      postalCode: null,
      country: "MYS",
      phone: null,
      email: null,
      sstRegistration: null,
      ttxRegistration: null,
      industryCode: null,
      industryName: null,
      myinvoisClientId: null,
      myinvoisClientSecret: null,
      myinvoisEnv: "SANDBOX",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe("consolidateItems", () => {
  it("should return empty array for empty invoices", () => {
    const result = consolidateItems([]);
    expect(result).toEqual([]);
  });

  it("should consolidate items from single invoice", () => {
    const invoice = createMockInvoice("1", [
      {
        description: "Americano",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 12,
        discount: 0,
        taxAmount: 1.44,
        total: 25.44,
      },
    ]);

    const result = consolidateItems([invoice]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      description: "Americano",
      taxCode: "02",
      quantity: 2,
      unitPrice: 12,
    });
  });

  it("should merge items with same description and taxCode", () => {
    const invoice1 = createMockInvoice("1", [
      {
        description: "Americano",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 12,
        discount: 0,
        taxAmount: 1.44,
        total: 25.44,
      },
    ]);

    const invoice2 = createMockInvoice("2", [
      {
        description: "Americano",
        taxCode: "02",
        taxRate: 6,
        quantity: 3,
        unitPrice: 12,
        discount: 0,
        taxAmount: 2.16,
        total: 38.16,
      },
    ]);

    const result = consolidateItems([invoice1, invoice2]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      description: "Americano",
      taxCode: "02",
      quantity: 5, // 2 + 3
      unitPrice: 12,
    });
    expect(result[0].taxAmount).toBeCloseTo(3.6, 2); // 1.44 + 2.16
  });

  it("should keep items with different taxCode separate", () => {
    const invoice = createMockInvoice("1", [
      {
        description: "Coffee",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 12,
        discount: 0,
        taxAmount: 1.44,
        total: 25.44,
      },
      {
        description: "Coffee",
        taxCode: "E", // Tax exempt
        taxRate: 0,
        quantity: 1,
        unitPrice: 10,
        discount: 0,
        taxAmount: 0,
        total: 10,
      },
    ]);

    const result = consolidateItems([invoice]);

    expect(result).toHaveLength(2);
    expect(result.find((i) => i.taxCode === "02")?.quantity).toBe(2);
    expect(result.find((i) => i.taxCode === "E")?.quantity).toBe(1);
  });

  it("should keep items with different description separate", () => {
    const invoice = createMockInvoice("1", [
      {
        description: "Americano",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 12,
        discount: 0,
        taxAmount: 1.44,
        total: 25.44,
      },
      {
        description: "Latte",
        taxCode: "02",
        taxRate: 6,
        quantity: 1,
        unitPrice: 14,
        discount: 0,
        taxAmount: 0.84,
        total: 14.84,
      },
    ]);

    const result = consolidateItems([invoice]);

    expect(result).toHaveLength(2);
    expect(result.find((i) => i.description === "Americano")?.quantity).toBe(2);
    expect(result.find((i) => i.description === "Latte")?.quantity).toBe(1);
  });

  it("should handle multiple invoices with multiple items", () => {
    const invoice1 = createMockInvoice("1", [
      {
        description: "Americano",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 12,
        discount: 0,
        taxAmount: 1.44,
        total: 25.44,
      },
      {
        description: "Latte",
        taxCode: "02",
        taxRate: 6,
        quantity: 1,
        unitPrice: 14,
        discount: 0,
        taxAmount: 0.84,
        total: 14.84,
      },
    ]);

    const invoice2 = createMockInvoice("2", [
      {
        description: "Americano",
        taxCode: "02",
        taxRate: 6,
        quantity: 1,
        unitPrice: 12,
        discount: 0,
        taxAmount: 0.72,
        total: 12.72,
      },
      {
        description: "Croissant",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 8,
        discount: 0,
        taxAmount: 0.96,
        total: 16.96,
      },
    ]);

    const invoice3 = createMockInvoice("3", [
      {
        description: "Latte",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 14,
        discount: 0,
        taxAmount: 1.68,
        total: 29.68,
      },
    ]);

    const result = consolidateItems([invoice1, invoice2, invoice3]);

    expect(result).toHaveLength(3);
    expect(result.find((i) => i.description === "Americano")?.quantity).toBe(3); // 2 + 1
    expect(result.find((i) => i.description === "Latte")?.quantity).toBe(3); // 1 + 2
    expect(result.find((i) => i.description === "Croissant")?.quantity).toBe(2);
  });

  it("should handle invoices with invalid JSON payload", () => {
    const validInvoice = createMockInvoice("1", [
      {
        description: "Americano",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 12,
        discount: 0,
        taxAmount: 1.44,
        total: 25.44,
      },
    ]);

    const invalidInvoice: InvoiceWithCompany = {
      ...validInvoice,
      id: "2",
      invoiceNumber: "INV-2",
      rawPayload: "invalid json {{{",
    };

    const result = consolidateItems([validInvoice, invalidInvoice]);

    // Should still have items from the valid invoice
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Americano");
  });

  it("should sum discounts correctly", () => {
    const invoice1 = createMockInvoice("1", [
      {
        description: "Coffee",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 12,
        discount: 2,
        taxAmount: 1.32,
        total: 23.32,
      },
    ]);

    const invoice2 = createMockInvoice("2", [
      {
        description: "Coffee",
        taxCode: "02",
        taxRate: 6,
        quantity: 1,
        unitPrice: 12,
        discount: 1,
        taxAmount: 0.66,
        total: 11.66,
      },
    ]);

    const result = consolidateItems([invoice1, invoice2]);

    expect(result).toHaveLength(1);
    expect(result[0].discount).toBe(3); // 2 + 1
  });

  it("should handle hashlhdn/documents/submit rawPayload format (nested invoices[0].items)", () => {
    // This format is used by /documents/submit with SaveInvoice: true
    // The rawPayload is stored as the entire request body: { CompanyId, invoices: [{ items: [...] }] }
    const nestedFormatInvoice: InvoiceWithCompany = {
      id: "nested-1",
      companyId: "company-1",
      invoiceNumber: "INV-NESTED-1",
      posInvoiceId: null,
      invoiceDate: new Date(),
      invoiceType: "JUSTSAVE",
      status: "DRAFT",
      version: 1, // P1-07: Optimistic locking version
      rawPayload: JSON.stringify({
        CompanyId: "company-1",
        SaveInvoice: true,
        invoices: [
          {
            invoiceNumber: "INV-NESTED-1",
            invoiceDate: "2026-01-28T12:00:00Z",
            amount: 24,
            taxAmount: 1.44,
            total: 25.44,
            items: [
              {
                description: "Widget",
                taxCode: "02",
                taxRate: 6,
                quantity: 2,
                unitPrice: 12,
                discount: 0,
                taxAmount: 1.44,
                total: 25.44,
              },
            ],
          },
        ],
      }),
      ublPayload: null,
      trackingId: "HASH-ABC123",
      myinvoisUuid: null,
      myinvoisLongId: null,
      amount: "24",
      discount: "0",
      rounding: "0",
      taxAmount: "1.44",
      total: "25.44",
      buyerInfo: null,
      errorMessage: null,
      errorCode: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      company: {
        id: "company-1",
        name: "Test Company",
        tin: "C12345678900",
        idValue: "12345678",
        idType: "BRN",
        address: null,
        city: null,
        state: null,
        postalCode: null,
        country: "MYS",
        phone: null,
        email: null,
        sstRegistration: null,
        ttxRegistration: null,
        industryCode: null,
        industryName: null,
        myinvoisClientId: null,
        myinvoisClientSecret: null,
        myinvoisEnv: "SANDBOX",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    const result = consolidateItems([nestedFormatInvoice]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      description: "Widget",
      taxCode: "02",
      quantity: 2,
      unitPrice: 12,
    });
  });

  it("should consolidate items from both POS and documents/submit formats together", () => {
    // POS format: { items: [...] } at root
    const posInvoice = createMockInvoice("pos-1", [
      {
        description: "Coffee",
        taxCode: "02",
        taxRate: 6,
        quantity: 3,
        unitPrice: 10,
        discount: 0,
        taxAmount: 1.8,
        total: 31.8,
      },
    ]);

    // documents/submit format: { invoices: [{ items: [...] }] } nested
    const docSubmitInvoice: InvoiceWithCompany = {
      ...posInvoice,
      id: "doc-1",
      invoiceNumber: "INV-DOC-1",
      invoiceType: "JUSTSAVE",
      rawPayload: JSON.stringify({
        CompanyId: "company-1",
        SaveInvoice: true,
        invoices: [
          {
            invoiceNumber: "INV-DOC-1",
            items: [
              {
                description: "Coffee", // Same description + taxCode as POS
                taxCode: "02",
                taxRate: 6,
                quantity: 2,
                unitPrice: 10,
                discount: 0,
                taxAmount: 1.2,
                total: 21.2,
              },
            ],
          },
        ],
      }),
    };

    const result = consolidateItems([posInvoice, docSubmitInvoice]);

    // Should merge Coffee items from both sources
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      description: "Coffee",
      taxCode: "02",
      quantity: 5, // 3 from POS + 2 from documents/submit
    });
  });
});

describe("calculateTotals", () => {
  it("should return zeros for empty items", () => {
    const result = calculateTotals([]);

    expect(result).toEqual({
      amount: 0,
      discount: 0,
      taxAmount: 0,
      total: 0,
    });
  });

  it("should calculate totals correctly", () => {
    const items: ConsolidatedItem[] = [
      {
        description: "Americano",
        taxCode: "02",
        taxRate: 6,
        quantity: 3,
        unitPrice: 12,
        discount: 0,
        taxAmount: 2.16,
        total: 38.16,
      },
      {
        description: "Latte",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 14,
        discount: 0,
        taxAmount: 1.68,
        total: 29.68,
      },
    ];

    const result = calculateTotals(items);

    // Amount: (3 * 12) + (2 * 14) = 36 + 28 = 64
    expect(result.amount).toBe(64);
    expect(result.discount).toBe(0);
    expect(result.taxAmount).toBeCloseTo(3.84, 2); // 2.16 + 1.68
    expect(result.total).toBeCloseTo(67.84, 2); // 38.16 + 29.68
  });

  it("should handle discounts in total calculation", () => {
    const items: ConsolidatedItem[] = [
      {
        description: "Coffee",
        taxCode: "02",
        taxRate: 6,
        quantity: 2,
        unitPrice: 12,
        discount: 4,
        taxAmount: 1.2,
        total: 21.2,
      },
    ];

    const result = calculateTotals(items);

    expect(result.amount).toBe(24); // 2 * 12
    expect(result.discount).toBe(4);
    expect(result.taxAmount).toBe(1.2);
    expect(result.total).toBe(21.2);
  });
});
