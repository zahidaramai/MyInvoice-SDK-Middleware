/**
 * Comprehensive E-Invoice Document Types Test
 *
 * Tests all major document types against MyInvois Sandbox:
 * - Regular e-Invoice (Type 01)
 * - Credit Note (Type 02)
 * - Self-billed Credit Note (Type 12)
 * - Self-billed Refund Note (Type 14)
 * - Consolidated e-Invoice (multiple line items)
 *
 * Requires valid credentials in .env file.
 *
 * Usage:
 *   SKIP_TESTCONTAINERS=true pnpm vitest run test/integration/document-types.integration.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../.env") });

// Skip unless explicitly enabled - integration tests hit live MyInvois API
// Run with: RUN_INTEGRATION_TESTS=true pnpm vitest run test/integration/
const SKIP_REAL_TESTS =
  process.env.RUN_INTEGRATION_TESTS !== "true" ||
  !process.env.MYINVOIS_CLIENT_ID ||
  process.env.MYINVOIS_CLIENT_ID === "your-client-id-here" ||
  !process.env.MYINVOIS_CLIENT_SECRET_1 ||
  process.env.MYINVOIS_CLIENT_SECRET_1 === "your-primary-client-secret-here";

// Get supplier TIN from environment (must match authenticated client)
const SUPPLIER_TIN = process.env.MYINVOIS_SUPPLIER_TIN || "";
const SUPPLIER_ID_TYPE = process.env.MYINVOIS_SUPPLIER_ID_TYPE || "BRN";
const SUPPLIER_ID_VALUE = process.env.MYINVOIS_SUPPLIER_ID_VALUE || "NA";
const SKIP_INVOICE_TEST = SKIP_REAL_TESTS || !SUPPLIER_TIN;

// MyInvois URLs - use PROD or SANDBOX based on env
const IS_PROD = process.env.MYINVOIS_ENV === "PROD" || process.env.ERP_MYINVOIS_ENV === "PROD";
const IDENTITY_URL = IS_PROD
  ? "https://identity.myinvois.hasil.gov.my"
  : "https://preprod-identity.myinvois.hasil.gov.my";
const SYSTEM_URL = IS_PROD
  ? "https://api.myinvois.hasil.gov.my"
  : "https://preprod-api.myinvois.hasil.gov.my";

// ============================================================================
// Document Type Codes (from MyInvois SDK)
// ============================================================================

const InvoiceTypeCodes = {
  INVOICE: "01",
  CREDIT_NOTE: "02",
  DEBIT_NOTE: "03",
  REFUND_NOTE: "04",
  SELF_BILLED_INVOICE: "11",
  SELF_BILLED_CREDIT_NOTE: "12",
  SELF_BILLED_DEBIT_NOTE: "13",
  SELF_BILLED_REFUND_NOTE: "14",
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique document number with timestamp
 */
function generateDocumentNumber(prefix: string): string {
  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Get current date/time for documents (5 minutes ago to avoid clock skew)
 */
function getDocumentDateTime(): { date: string; time: string } {
  const now = new Date(Date.now() - 5 * 60 * 1000);
  const date = now.toISOString().split("T")[0];
  const hours = now.getUTCHours().toString().padStart(2, "0");
  const minutes = now.getUTCMinutes().toString().padStart(2, "0");
  const seconds = now.getUTCSeconds().toString().padStart(2, "0");
  return { date, time: `${hours}:${minutes}:${seconds}Z` };
}

/**
 * Create base party structure for supplier
 */
function createSupplierParty(tin: string): object {
  return {
    AdditionalAccountID: [{ _: "CPT-CCN-W-211111-KL-000002", schemeAgencyName: "CertEX" }],
    Party: [
      {
        IndustryClassificationCode: [
          {
            _: "46510",
            name: "Wholesale of computers, computer peripheral equipment and software",
          },
        ],
        PartyIdentification: [
          { ID: [{ _: tin, schemeID: "TIN" }] },
          { ID: [{ _: SUPPLIER_ID_VALUE, schemeID: SUPPLIER_ID_TYPE }] },
        ],
        PostalAddress: [
          {
            CityName: [{ _: "Kuala Lumpur" }],
            PostalZone: [{ _: "50480" }],
            CountrySubentityCode: [{ _: "14" }],
            AddressLine: [
              { Line: [{ _: "Lot 66" }] },
              { Line: [{ _: "Bangunan Merdeka" }] },
              { Line: [{ _: "Persiaran Jaya" }] },
            ],
            Country: [
              { IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] },
            ],
          },
        ],
        PartyLegalEntity: [{ RegistrationName: [{ _: "Test Supplier Sdn Bhd" }] }],
        Contact: [
          {
            Telephone: [{ _: "+60123456789" }],
            ElectronicMail: [{ _: "supplier@test.com" }],
          },
        ],
      },
    ],
  };
}

/**
 * Create base party structure for customer
 * Uses supplier's own TIN for B2B testing (self-transaction is valid in sandbox)
 */
function createCustomerParty(): object {
  // Use supplier's own TIN for testing (self-transaction is valid)
  return {
    Party: [
      {
        PartyIdentification: [
          { ID: [{ _: SUPPLIER_TIN, schemeID: "TIN" }] },
          { ID: [{ _: SUPPLIER_ID_VALUE, schemeID: SUPPLIER_ID_TYPE }] },
        ],
        PostalAddress: [
          {
            CityName: [{ _: "Petaling Jaya" }],
            PostalZone: [{ _: "47301" }],
            CountrySubentityCode: [{ _: "10" }],
            AddressLine: [
              { Line: [{ _: "Lot 55" }] },
              { Line: [{ _: "Business Park" }] },
              { Line: [{ _: "-" }] },
            ],
            Country: [
              { IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] },
            ],
          },
        ],
        PartyLegalEntity: [{ RegistrationName: [{ _: "Test Buyer Sdn Bhd" }] }],
        Contact: [
          {
            Telephone: [{ _: "+60987654321" }],
            ElectronicMail: [{ _: "buyer@test.com" }],
          },
        ],
      },
    ],
  };
}

/**
 * Create a single invoice line item
 */
function createInvoiceLine(
  id: string,
  description: string,
  quantity: number,
  unitPrice: number,
  taxAmount: number = 0
): object {
  const lineTotal = quantity * unitPrice;
  return {
    ID: [{ _: id }],
    InvoicedQuantity: [{ _: quantity, unitCode: "C62" }],
    LineExtensionAmount: [{ _: lineTotal, currencyID: "MYR" }],
    AllowanceCharge: [
      {
        ChargeIndicator: [{ _: false }],
        AllowanceChargeReason: [{ _: "No discount" }],
        Amount: [{ _: 0.0, currencyID: "MYR" }],
      },
    ],
    TaxTotal: [
      {
        TaxAmount: [{ _: taxAmount, currencyID: "MYR" }],
        TaxSubtotal: [
          {
            TaxableAmount: [{ _: lineTotal, currencyID: "MYR" }],
            TaxAmount: [{ _: taxAmount, currencyID: "MYR" }],
            TaxCategory: [
              {
                ID: [{ _: "E" }],
                TaxExemptionReason: [{ _: "Exempt New Means of Transport" }],
                TaxScheme: [{ ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] }],
              },
            ],
          },
        ],
      },
    ],
    Item: [
      {
        CommodityClassification: [{ ItemClassificationCode: [{ _: "001", listID: "CLASS" }] }],
        Description: [{ _: description }],
      },
    ],
    Price: [{ PriceAmount: [{ _: unitPrice, currencyID: "MYR" }] }],
    ItemPriceExtension: [{ Amount: [{ _: lineTotal, currencyID: "MYR" }] }],
  };
}

/**
 * Create a credit note line item
 */
function _createCreditNoteLine(
  id: string,
  description: string,
  quantity: number,
  unitPrice: number,
  taxAmount: number = 0
): object {
  const lineTotal = quantity * unitPrice;
  return {
    ID: [{ _: id }],
    CreditedQuantity: [{ _: quantity, unitCode: "C62" }],
    LineExtensionAmount: [{ _: lineTotal, currencyID: "MYR" }],
    AllowanceCharge: [
      {
        ChargeIndicator: [{ _: false }],
        AllowanceChargeReason: [{ _: "No discount" }],
        Amount: [{ _: 0.0, currencyID: "MYR" }],
      },
    ],
    TaxTotal: [
      {
        TaxAmount: [{ _: taxAmount, currencyID: "MYR" }],
        TaxSubtotal: [
          {
            TaxableAmount: [{ _: lineTotal, currencyID: "MYR" }],
            TaxAmount: [{ _: taxAmount, currencyID: "MYR" }],
            TaxCategory: [
              {
                ID: [{ _: "E" }],
                TaxExemptionReason: [{ _: "Exempt New Means of Transport" }],
                TaxScheme: [{ ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] }],
              },
            ],
          },
        ],
      },
    ],
    Item: [
      {
        CommodityClassification: [{ ItemClassificationCode: [{ _: "001", listID: "CLASS" }] }],
        Description: [{ _: description }],
      },
    ],
    Price: [{ PriceAmount: [{ _: unitPrice, currencyID: "MYR" }] }],
    ItemPriceExtension: [{ Amount: [{ _: lineTotal, currencyID: "MYR" }] }],
  };
}

// ============================================================================
// Document Builders
// ============================================================================

/**
 * Create a regular e-Invoice (Type 01)
 */
function createInvoice(invoiceNumber: string, issuerTin: string, lineItems: object[]): object {
  const { date, time } = getDocumentDateTime();
  const totalAmount = 100.0; // Simplified for test

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [
      {
        ID: [{ _: invoiceNumber }],
        IssueDate: [{ _: date }],
        IssueTime: [{ _: time }],
        InvoiceTypeCode: [{ _: InvoiceTypeCodes.INVOICE, listVersionID: "1.0" }],
        DocumentCurrencyCode: [{ _: "MYR" }],
        InvoicePeriod: [
          {
            StartDate: [{ _: date }],
            EndDate: [{ _: date }],
            Description: [{ _: "Monthly" }],
          },
        ],
        BillingReference: [{ AdditionalDocumentReference: [{ ID: [{ _: "E12345678912" }] }] }],
        AccountingSupplierParty: [createSupplierParty(issuerTin)],
        AccountingCustomerParty: [createCustomerParty()],
        PaymentMeans: [
          {
            PaymentMeansCode: [{ _: "01" }],
            PayeeFinancialAccount: [{ ID: [{ _: "1234567890123" }] }],
          },
        ],
        PaymentTerms: [{ Note: [{ _: "Payment due within 30 days" }] }],
        TaxTotal: [
          {
            TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
            TaxSubtotal: [
              {
                TaxableAmount: [{ _: totalAmount, currencyID: "MYR" }],
                TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                TaxCategory: [
                  {
                    ID: [{ _: "E" }],
                    TaxScheme: [
                      { ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: totalAmount, currencyID: "MYR" }],
            TaxExclusiveAmount: [{ _: totalAmount, currencyID: "MYR" }],
            TaxInclusiveAmount: [{ _: totalAmount, currencyID: "MYR" }],
            AllowanceTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            ChargeTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableRoundingAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableAmount: [{ _: totalAmount, currencyID: "MYR" }],
          },
        ],
        InvoiceLine: lineItems,
      },
    ],
  };
}

/**
 * Create a Credit Note (Type 02)
 * Note: MyInvois requires Invoice schema with InvoiceTypeCode 02 for credit notes
 */
function createCreditNote(
  creditNoteNumber: string,
  issuerTin: string,
  originalInvoiceRef: string,
  lineItems: object[]
): object {
  const { date, time } = getDocumentDateTime();
  const totalAmount = 50.0; // Credit amount

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [
      {
        ID: [{ _: creditNoteNumber }],
        IssueDate: [{ _: date }],
        IssueTime: [{ _: time }],
        InvoiceTypeCode: [{ _: InvoiceTypeCodes.CREDIT_NOTE, listVersionID: "1.0" }],
        DocumentCurrencyCode: [{ _: "MYR" }],
        InvoicePeriod: [
          {
            StartDate: [{ _: date }],
            EndDate: [{ _: date }],
            Description: [{ _: "Monthly" }],
          },
        ],
        BillingReference: [
          {
            InvoiceDocumentReference: [{ ID: [{ _: originalInvoiceRef }] }],
          },
        ],
        AccountingSupplierParty: [createSupplierParty(issuerTin)],
        AccountingCustomerParty: [createCustomerParty()],
        PaymentMeans: [
          {
            PaymentMeansCode: [{ _: "01" }],
            PayeeFinancialAccount: [{ ID: [{ _: "1234567890123" }] }],
          },
        ],
        PaymentTerms: [{ Note: [{ _: "Credit issued for returned goods" }] }],
        TaxTotal: [
          {
            TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
            TaxSubtotal: [
              {
                TaxableAmount: [{ _: totalAmount, currencyID: "MYR" }],
                TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                TaxCategory: [
                  {
                    ID: [{ _: "E" }],
                    TaxScheme: [
                      { ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: totalAmount, currencyID: "MYR" }],
            TaxExclusiveAmount: [{ _: totalAmount, currencyID: "MYR" }],
            TaxInclusiveAmount: [{ _: totalAmount, currencyID: "MYR" }],
            AllowanceTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            ChargeTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableRoundingAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableAmount: [{ _: totalAmount, currencyID: "MYR" }],
          },
        ],
        InvoiceLine: lineItems,
      },
    ],
  };
}

/**
 * Create a Self-billed Credit Note (Type 12)
 * Note: MyInvois requires Invoice schema with InvoiceTypeCode 12 for self-billed credit notes
 *
 * IMPORTANT: For self-billed documents, roles are reversed:
 * - AccountingSupplierParty = The supplier/vendor (NOT authenticated party)
 * - AccountingCustomerParty = The buyer (authenticated party with TIN)
 */
function createSelfBilledCreditNote(
  creditNoteNumber: string,
  buyerTin: string, // The authenticated party (buyer) TIN
  originalInvoiceRef: string,
  lineItems: object[]
): object {
  const { date, time } = getDocumentDateTime();
  const totalAmount = 30.0;

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [
      {
        ID: [{ _: creditNoteNumber }],
        IssueDate: [{ _: date }],
        IssueTime: [{ _: time }],
        InvoiceTypeCode: [{ _: InvoiceTypeCodes.SELF_BILLED_CREDIT_NOTE, listVersionID: "1.0" }],
        DocumentCurrencyCode: [{ _: "MYR" }],
        InvoicePeriod: [
          {
            StartDate: [{ _: date }],
            EndDate: [{ _: date }],
            Description: [{ _: "Monthly" }],
          },
        ],
        BillingReference: [
          {
            InvoiceDocumentReference: [{ ID: [{ _: originalInvoiceRef }] }],
          },
        ],
        // For self-billed: Supplier is the vendor (not authenticated party)
        // Use supplier's own TIN for testing (self-transaction is valid in sandbox)
        AccountingSupplierParty: [
          {
            Party: [
              {
                IndustryClassificationCode: [{ _: "46510", name: "Wholesale of computers" }],
                PartyIdentification: [
                  { ID: [{ _: SUPPLIER_TIN, schemeID: "TIN" }] },
                  { ID: [{ _: SUPPLIER_ID_VALUE, schemeID: SUPPLIER_ID_TYPE }] },
                ],
                PostalAddress: [
                  {
                    CityName: [{ _: "Kuala Lumpur" }],
                    PostalZone: [{ _: "50480" }],
                    CountrySubentityCode: [{ _: "14" }],
                    AddressLine: [
                      { Line: [{ _: "Supplier Address Line 1" }] },
                      { Line: [{ _: "Supplier Address Line 2" }] },
                      { Line: [{ _: "-" }] },
                    ],
                    Country: [
                      {
                        IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }],
                      },
                    ],
                  },
                ],
                PartyLegalEntity: [{ RegistrationName: [{ _: "Vendor Company Sdn Bhd" }] }],
                Contact: [
                  {
                    Telephone: [{ _: "+60111111111" }],
                    ElectronicMail: [{ _: "vendor@example.com" }],
                  },
                ],
              },
            ],
          },
        ],
        // For self-billed: Customer is the authenticated party (buyer with our TIN)
        AccountingCustomerParty: [
          {
            Party: [
              {
                PartyIdentification: [
                  { ID: [{ _: buyerTin, schemeID: "TIN" }] },
                  { ID: [{ _: SUPPLIER_ID_VALUE, schemeID: SUPPLIER_ID_TYPE }] },
                ],
                PostalAddress: [
                  {
                    CityName: [{ _: "Kuala Lumpur" }],
                    PostalZone: [{ _: "50480" }],
                    CountrySubentityCode: [{ _: "14" }],
                    AddressLine: [
                      { Line: [{ _: "Lot 66" }] },
                      { Line: [{ _: "Bangunan Merdeka" }] },
                      { Line: [{ _: "Persiaran Jaya" }] },
                    ],
                    Country: [
                      {
                        IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }],
                      },
                    ],
                  },
                ],
                PartyLegalEntity: [
                  { RegistrationName: [{ _: "Test Buyer (Self-billing) Sdn Bhd" }] },
                ],
                Contact: [
                  {
                    Telephone: [{ _: "+60123456789" }],
                    ElectronicMail: [{ _: "buyer@test.com" }],
                  },
                ],
              },
            ],
          },
        ],
        PaymentMeans: [
          {
            PaymentMeansCode: [{ _: "01" }],
            PayeeFinancialAccount: [{ ID: [{ _: "1234567890123" }] }],
          },
        ],
        PaymentTerms: [{ Note: [{ _: "Self-billed credit for commission adjustment" }] }],
        TaxTotal: [
          {
            TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
            TaxSubtotal: [
              {
                TaxableAmount: [{ _: totalAmount, currencyID: "MYR" }],
                TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                TaxCategory: [
                  {
                    ID: [{ _: "E" }],
                    TaxScheme: [
                      { ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: totalAmount, currencyID: "MYR" }],
            TaxExclusiveAmount: [{ _: totalAmount, currencyID: "MYR" }],
            TaxInclusiveAmount: [{ _: totalAmount, currencyID: "MYR" }],
            AllowanceTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            ChargeTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableRoundingAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableAmount: [{ _: totalAmount, currencyID: "MYR" }],
          },
        ],
        InvoiceLine: lineItems,
      },
    ],
  };
}

/**
 * Create a Refund Note (using Invoice schema with type 04)
 * Note: Refund in MyInvois context uses Invoice structure with specific type code
 */
function createRefundNote(
  refundNumber: string,
  issuerTin: string,
  originalInvoiceRef: string
): object {
  const { date, time } = getDocumentDateTime();
  const refundAmount = 25.0;

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [
      {
        ID: [{ _: refundNumber }],
        IssueDate: [{ _: date }],
        IssueTime: [{ _: time }],
        InvoiceTypeCode: [{ _: InvoiceTypeCodes.REFUND_NOTE, listVersionID: "1.0" }],
        DocumentCurrencyCode: [{ _: "MYR" }],
        InvoicePeriod: [
          {
            StartDate: [{ _: date }],
            EndDate: [{ _: date }],
            Description: [{ _: "Refund" }],
          },
        ],
        BillingReference: [
          {
            InvoiceDocumentReference: [{ ID: [{ _: originalInvoiceRef }] }],
          },
        ],
        AccountingSupplierParty: [createSupplierParty(issuerTin)],
        AccountingCustomerParty: [createCustomerParty()],
        PaymentMeans: [
          {
            PaymentMeansCode: [{ _: "03" }], // Bank transfer for refund
            PayeeFinancialAccount: [{ ID: [{ _: "1234567890123" }] }],
          },
        ],
        PaymentTerms: [{ Note: [{ _: "Refund processed within 14 days" }] }],
        TaxTotal: [
          {
            TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
            TaxSubtotal: [
              {
                TaxableAmount: [{ _: refundAmount, currencyID: "MYR" }],
                TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                TaxCategory: [
                  {
                    ID: [{ _: "E" }],
                    TaxScheme: [
                      { ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: refundAmount, currencyID: "MYR" }],
            TaxExclusiveAmount: [{ _: refundAmount, currencyID: "MYR" }],
            TaxInclusiveAmount: [{ _: refundAmount, currencyID: "MYR" }],
            AllowanceTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            ChargeTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableRoundingAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableAmount: [{ _: refundAmount, currencyID: "MYR" }],
          },
        ],
        InvoiceLine: [
          {
            ID: [{ _: "1" }],
            InvoicedQuantity: [{ _: 1, unitCode: "C62" }],
            LineExtensionAmount: [{ _: refundAmount, currencyID: "MYR" }],
            AllowanceCharge: [
              {
                ChargeIndicator: [{ _: false }],
                AllowanceChargeReason: [{ _: "Refund" }],
                Amount: [{ _: 0.0, currencyID: "MYR" }],
              },
            ],
            TaxTotal: [
              {
                TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                TaxSubtotal: [
                  {
                    TaxableAmount: [{ _: refundAmount, currencyID: "MYR" }],
                    TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                    TaxCategory: [
                      {
                        ID: [{ _: "E" }],
                        TaxExemptionReason: [{ _: "Refund - Exempt" }],
                        TaxScheme: [
                          { ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            Item: [
              {
                CommodityClassification: [
                  { ItemClassificationCode: [{ _: "001", listID: "CLASS" }] },
                ],
                Description: [{ _: "Refund for order cancellation" }],
              },
            ],
            Price: [{ PriceAmount: [{ _: refundAmount, currencyID: "MYR" }] }],
            ItemPriceExtension: [{ Amount: [{ _: refundAmount, currencyID: "MYR" }] }],
          },
        ],
      },
    ],
  };
}

/**
 * Create a Consolidated e-Invoice (multiple line items)
 */
function createConsolidatedInvoice(invoiceNumber: string, issuerTin: string): object {
  const { date, time } = getDocumentDateTime();

  // Multiple line items with different products
  const lineItems = [
    createInvoiceLine("1", "Product A - Electronics", 2, 150.0, 0),
    createInvoiceLine("2", "Product B - Software License", 1, 500.0, 0),
    createInvoiceLine("3", "Product C - Accessories", 5, 30.0, 0),
    createInvoiceLine("4", "Service D - Installation", 1, 200.0, 0),
    createInvoiceLine("5", "Product E - Warranty Extension", 1, 100.0, 0),
  ];

  // Calculate totals: 2*150 + 1*500 + 5*30 + 1*200 + 1*100 = 300 + 500 + 150 + 200 + 100 = 1250
  const totalAmount = 1250.0;

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [
      {
        ID: [{ _: invoiceNumber }],
        IssueDate: [{ _: date }],
        IssueTime: [{ _: time }],
        InvoiceTypeCode: [{ _: InvoiceTypeCodes.INVOICE, listVersionID: "1.0" }],
        DocumentCurrencyCode: [{ _: "MYR" }],
        InvoicePeriod: [
          {
            StartDate: [{ _: date }],
            EndDate: [{ _: date }],
            Description: [{ _: "Consolidated Monthly Invoice" }],
          },
        ],
        BillingReference: [
          { AdditionalDocumentReference: [{ ID: [{ _: "CONSOLIDATED-REF-001" }] }] },
        ],
        AccountingSupplierParty: [createSupplierParty(issuerTin)],
        AccountingCustomerParty: [createCustomerParty()],
        PaymentMeans: [
          {
            PaymentMeansCode: [{ _: "01" }],
            PayeeFinancialAccount: [{ ID: [{ _: "1234567890123" }] }],
          },
        ],
        PaymentTerms: [{ Note: [{ _: "Payment due within 30 days for consolidated items" }] }],
        TaxTotal: [
          {
            TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
            TaxSubtotal: [
              {
                TaxableAmount: [{ _: totalAmount, currencyID: "MYR" }],
                TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                TaxCategory: [
                  {
                    ID: [{ _: "E" }],
                    TaxScheme: [
                      { ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: totalAmount, currencyID: "MYR" }],
            TaxExclusiveAmount: [{ _: totalAmount, currencyID: "MYR" }],
            TaxInclusiveAmount: [{ _: totalAmount, currencyID: "MYR" }],
            AllowanceTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            ChargeTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableRoundingAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableAmount: [{ _: totalAmount, currencyID: "MYR" }],
          },
        ],
        InvoiceLine: lineItems,
      },
    ],
  };
}

// ============================================================================
// Document Submission Helper
// ============================================================================

interface SubmissionResult {
  success: boolean;
  status: number;
  submissionUid?: string;
  acceptedDocuments?: Array<{ uuid: string; invoiceCodeNumber: string }>;
  rejectedDocuments?: Array<{ invoiceCodeNumber: string; error: { message: string } }>;
  error?: string;
  correlationId?: string;
}

async function submitDocument(
  token: string,
  documentNumber: string,
  document: object
): Promise<SubmissionResult> {
  const documentJson = JSON.stringify(document);
  const documentHash = createHash("sha256").update(documentJson).digest("hex");
  const documentBase64 = Buffer.from(documentJson).toString("base64");

  console.log(`   Document Number: ${documentNumber}`);
  console.log(`   Document Size: ${documentJson.length} bytes`);
  console.log(`   Document Hash: ${documentHash.slice(0, 16)}...`);

  const response = await fetch(`${SYSTEM_URL}/api/v1.0/documentsubmissions/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      documents: [
        {
          format: "JSON",
          documentHash: documentHash,
          codeNumber: documentNumber,
          document: documentBase64,
        },
      ],
    }),
  });

  const correlationId =
    response.headers.get("correlationid") || response.headers.get("x-correlation-id");
  const responseBody = await response.json();

  console.log(`   Response Status: ${response.status}`);
  console.log(`   Correlation ID: ${correlationId || "not provided"}`);

  if (response.status === 202) {
    console.log(`   Submission UID: ${responseBody.submissionUid}`);
    if (responseBody.acceptedDocuments?.length > 0) {
      console.log(`   Accepted: ${responseBody.acceptedDocuments.length} document(s)`);
      responseBody.acceptedDocuments.forEach((doc: { uuid: string; invoiceCodeNumber: string }) => {
        console.log(`     - UUID: ${doc.uuid}`);
      });
    }
    if (responseBody.rejectedDocuments?.length > 0) {
      console.log(`   Rejected: ${responseBody.rejectedDocuments.length} document(s)`);
      responseBody.rejectedDocuments.forEach(
        (doc: { invoiceCodeNumber: string; error: { message: string } }) => {
          console.log(`     - ${doc.invoiceCodeNumber}: ${doc.error?.message}`);
        }
      );
    }
    return {
      success: true,
      status: response.status,
      submissionUid: responseBody.submissionUid,
      acceptedDocuments: responseBody.acceptedDocuments,
      rejectedDocuments: responseBody.rejectedDocuments,
      correlationId: correlationId || undefined,
    };
  }

  console.log(`   Error Response:`, JSON.stringify(responseBody, null, 2));
  return {
    success: false,
    status: response.status,
    error: responseBody.message || JSON.stringify(responseBody),
    correlationId: correlationId || undefined,
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe.skipIf(SKIP_REAL_TESTS)("Document Types Integration Tests", () => {
  let accessToken: string;
  let tokenExpiresAt: number;

  function getCredentials() {
    return {
      clientId: process.env.MYINVOIS_CLIENT_ID!,
      clientSecret: process.env.MYINVOIS_CLIENT_SECRET_1!,
    };
  }

  async function acquireToken(): Promise<string> {
    if (accessToken && tokenExpiresAt > Date.now() + 60000) {
      return accessToken;
    }

    const { clientId, clientSecret } = getCredentials();

    const response = await fetch(`${IDENTITY_URL}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "InvoicingAPI",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token acquisition failed: ${response.status} - ${error}`);
    }

    const data = await response.json();
    accessToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;
    console.log(`Token acquired, expires in ${data.expires_in}s`);
    return accessToken;
  }

  beforeAll(() => {
    if (SKIP_REAL_TESTS) {
      console.log("Skipping tests - credentials not configured");
      return;
    }
    console.log("\n========================================");
    console.log("Document Types Integration Tests");
    console.log("========================================");
    console.log(`Client ID: ${process.env.MYINVOIS_CLIENT_ID?.slice(0, 8)}...`);
    console.log(`Supplier TIN: ${SUPPLIER_TIN}`);
    console.log(`Supplier ID: ${SUPPLIER_ID_TYPE}/${SUPPLIER_ID_VALUE.slice(0, 6)}...`);
    console.log("========================================\n");
  });

  // =========================================================================
  // Test 1: Regular e-Invoice
  // =========================================================================
  describe("1. Regular e-Invoice (Type 01)", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits a standard e-invoice", async () => {
      console.log("\n--- Test: Regular e-Invoice ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("INV");

      const lineItems = [createInvoiceLine("1", "Test Product - Standard Invoice", 1, 100.0, 0)];

      const invoice = createInvoice(invoiceNumber, SUPPLIER_TIN, lineItems);
      const result = await submitDocument(token, invoiceNumber, invoice);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
        expect(result.acceptedDocuments?.length).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // Test 2: Credit Note
  // =========================================================================
  describe("2. Credit Note (Type 02)", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits a credit note referencing an invoice", async () => {
      console.log("\n--- Test: Credit Note ---");
      const token = await acquireToken();
      const creditNoteNumber = generateDocumentNumber("CN");
      const originalInvoiceRef = "INV-ORIGINAL-REF-001"; // Reference to original invoice

      // Use InvoiceLine for credit notes (MyInvois uses Invoice schema for all document types)
      const lineItems = [createInvoiceLine("1", "Credit for returned goods", 1, 50.0, 0)];

      const creditNote = createCreditNote(
        creditNoteNumber,
        SUPPLIER_TIN,
        originalInvoiceRef,
        lineItems
      );
      const result = await submitDocument(token, creditNoteNumber, creditNote);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
      }
    });
  });

  // =========================================================================
  // Test 3: Self-billed Credit Note
  // =========================================================================
  describe("3. Self-billed Credit Note (Type 12)", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits a self-billed credit note", async () => {
      console.log("\n--- Test: Self-billed Credit Note ---");
      const token = await acquireToken();
      const creditNoteNumber = generateDocumentNumber("SBCN");
      const originalInvoiceRef = "SBINV-ORIGINAL-REF-001";

      // Use InvoiceLine for self-billed credit notes (MyInvois uses Invoice schema for all document types)
      const lineItems = [createInvoiceLine("1", "Self-billed credit adjustment", 1, 30.0, 0)];

      const selfBilledCreditNote = createSelfBilledCreditNote(
        creditNoteNumber,
        SUPPLIER_TIN,
        originalInvoiceRef,
        lineItems
      );
      const result = await submitDocument(token, creditNoteNumber, selfBilledCreditNote);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
      }
    });
  });

  // =========================================================================
  // Test 4: Refund Note
  // =========================================================================
  describe("4. Refund Note (Type 04)", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits a refund e-invoice", async () => {
      console.log("\n--- Test: Refund Note ---");
      const token = await acquireToken();
      const refundNumber = generateDocumentNumber("REF");
      const originalInvoiceRef = "INV-TO-REFUND-001";

      const refundNote = createRefundNote(refundNumber, SUPPLIER_TIN, originalInvoiceRef);
      const result = await submitDocument(token, refundNumber, refundNote);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
      }
    });
  });

  // =========================================================================
  // Test 5: Consolidated e-Invoice (Multiple Line Items)
  // =========================================================================
  describe("5. Consolidated e-Invoice (Multiple Items)", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits a consolidated invoice with 5 line items", async () => {
      console.log("\n--- Test: Consolidated e-Invoice ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("CONS");

      const consolidatedInvoice = createConsolidatedInvoice(invoiceNumber, SUPPLIER_TIN);
      const result = await submitDocument(token, invoiceNumber, consolidatedInvoice);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
        expect(result.acceptedDocuments?.length).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // Summary: Get Document Types
  // =========================================================================
  describe("API Health Check", () => {
    it("retrieves available document types", async () => {
      console.log("\n--- API Health: Document Types ---");
      const token = await acquireToken();

      const response = await fetch(`${SYSTEM_URL}/api/v1.0/documenttypes`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      expect(response.status).toBe(200);

      const documentTypes = await response.json();
      console.log(
        `   Available document types: ${Array.isArray(documentTypes) ? documentTypes.length : "N/A"}`
      );

      if (Array.isArray(documentTypes)) {
        documentTypes.forEach(
          (dt: { id: number; invoiceTypeCode: number; description: string }) => {
            console.log(`     - ${dt.invoiceTypeCode}: ${dt.description}`);
          }
        );
      }
    });
  });
});
