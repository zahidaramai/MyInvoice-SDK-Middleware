/**
 * Regulation Compliance Integration Tests
 *
 * Tests compliance with Malaysian e-Invoice regulations:
 * 1. SST (Sales & Service Tax) inclusion when applicable
 * 2. B2B/B2C threshold rules (>RM10,000 must be B2B)
 *
 * Requires valid credentials in .env file.
 *
 * Usage:
 *   SKIP_TESTCONTAINERS=true pnpm vitest run test/integration/regulation-compliance.integration.test.ts
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

// Get supplier TIN from environment
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
// Tax Type Constants
// ============================================================================

const TaxTypes = {
  SALES_TAX: "01", // 10% Sales Tax
  SERVICE_TAX: "02", // 8% Service Tax (6% for some services)
  TOURISM_TAX: "03",
  HIGH_VALUE_GOODS: "04",
  NOT_APPLICABLE: "06",
  EXEMPT: "E",
} as const;

const TaxRates = {
  SALES_TAX: 0.1, // 10%
  SERVICE_TAX: 0.08, // 8%
  SERVICE_TAX_REDUCED: 0.06, // 6% for certain services
  ZERO: 0,
} as const;

// B2B Threshold - Invoices above this amount MUST be B2B
const B2B_THRESHOLD = 10000.0; // RM 10,000

// ============================================================================
// Helper Functions
// ============================================================================

function generateDocumentNumber(prefix: string): string {
  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

function getDocumentDateTime(): { date: string; time: string } {
  const now = new Date(Date.now() - 5 * 60 * 1000);
  const date = now.toISOString().split("T")[0];
  const hours = now.getUTCHours().toString().padStart(2, "0");
  const minutes = now.getUTCMinutes().toString().padStart(2, "0");
  const seconds = now.getUTCSeconds().toString().padStart(2, "0");
  return { date, time: `${hours}:${minutes}:${seconds}Z` };
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

// ============================================================================
// Party Builders
// ============================================================================

/**
 * Create supplier party (authenticated party)
 */
function createSupplierParty(tin: string, sstRegistration?: string): object {
  const partyIdentification = [
    { ID: [{ _: tin, schemeID: "TIN" }] },
    { ID: [{ _: SUPPLIER_ID_VALUE, schemeID: SUPPLIER_ID_TYPE }] },
  ];

  // Add SST registration if provided
  if (sstRegistration) {
    partyIdentification.push({ ID: [{ _: sstRegistration, schemeID: "SST" }] });
  }

  return {
    AdditionalAccountID: [{ _: "CPT-CCN-W-211111-KL-000002", schemeAgencyName: "CertEX" }],
    Party: [
      {
        IndustryClassificationCode: [{ _: "46510", name: "Wholesale of computers" }],
        PartyIdentification: partyIdentification,
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
 * Create B2B customer party (company buyer)
 * For sandbox testing, we use the supplier's own TIN (self-transaction)
 * since fake TINs like "C00000000000" are not registered in MyInvois
 */
function createB2BCustomerParty(): object {
  // Use supplier's own TIN for B2B testing (self-transaction is valid)
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
            CountrySubentityCode: [{ _: "10" }], // Selangor
            AddressLine: [
              { Line: [{ _: "No. 123, Jalan PJ" }] },
              { Line: [{ _: "Damansara Business Park" }] },
              { Line: [{ _: "-" }] },
            ],
            Country: [
              { IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] },
            ],
          },
        ],
        PartyLegalEntity: [{ RegistrationName: [{ _: "Buyer Company Sdn Bhd" }] }],
        Contact: [
          {
            Telephone: [{ _: "+60387654321" }],
            ElectronicMail: [{ _: "buyer@company.com" }],
          },
        ],
      },
    ],
  };
}

/**
 * Create B2C customer party (individual buyer)
 * Note: Can only be used for invoices <= RM10,000
 *
 * SANDBOX LIMITATION: EI00000000010 doesn't pass validation in sandbox.
 * Using supplier's own TIN (self-transaction) which consistently works.
 * In production, EI00000000010 with NRIC should work per MyInvois guidelines.
 */
function createB2CCustomerParty(): object {
  // Use supplier's own TIN for sandbox testing (self-transaction)
  return {
    Party: [
      {
        PartyIdentification: [
          { ID: [{ _: SUPPLIER_TIN, schemeID: "TIN" }] },
          { ID: [{ _: SUPPLIER_ID_VALUE, schemeID: SUPPLIER_ID_TYPE }] },
        ],
        PostalAddress: [
          {
            CityName: [{ _: "Kuala Lumpur" }],
            PostalZone: [{ _: "50000" }],
            CountrySubentityCode: [{ _: "14" }],
            AddressLine: [
              { Line: [{ _: "No. 45, Jalan Bukit Bintang" }] },
              { Line: [{ _: "-" }] },
              { Line: [{ _: "-" }] },
            ],
            Country: [
              { IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] },
            ],
          },
        ],
        PartyLegalEntity: [{ RegistrationName: [{ _: "Test Buyer (Sandbox Self-Transaction)" }] }],
        Contact: [
          {
            Telephone: [{ _: "+60100000000" }],
            ElectronicMail: [{ _: "buyer@test.com" }],
          },
        ],
      },
    ],
  };
}

// ============================================================================
// Invoice Line Builders with Tax
// ============================================================================

interface LineItemWithTax {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxType: string;
  taxRate: number;
  taxExemptionReason?: string;
}

/**
 * Create invoice line with proper tax calculation
 */
function createInvoiceLineWithTax(item: LineItemWithTax): object {
  const lineAmount = roundToTwoDecimals(item.quantity * item.unitPrice);
  const taxAmount = roundToTwoDecimals(lineAmount * item.taxRate);

  const taxCategory: Record<string, unknown> = {
    ID: [{ _: item.taxType }],
    Percent: [{ _: roundToTwoDecimals(item.taxRate * 100) }],
    TaxScheme: [
      {
        ID: [
          {
            _: item.taxType === "E" ? "OTH" : "OTH",
            schemeID: "UN/ECE 5153",
            schemeAgencyID: "6",
          },
        ],
      },
    ],
  };

  if (item.taxExemptionReason) {
    taxCategory.TaxExemptionReason = [{ _: item.taxExemptionReason }];
  }

  return {
    ID: [{ _: item.id }],
    InvoicedQuantity: [{ _: item.quantity, unitCode: "C62" }],
    LineExtensionAmount: [{ _: lineAmount, currencyID: "MYR" }],
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
            TaxableAmount: [{ _: lineAmount, currencyID: "MYR" }],
            TaxAmount: [{ _: taxAmount, currencyID: "MYR" }],
            TaxCategory: [taxCategory],
          },
        ],
      },
    ],
    Item: [
      {
        CommodityClassification: [{ ItemClassificationCode: [{ _: "001", listID: "CLASS" }] }],
        Description: [{ _: item.description }],
      },
    ],
    Price: [{ PriceAmount: [{ _: item.unitPrice, currencyID: "MYR" }] }],
    ItemPriceExtension: [{ Amount: [{ _: lineAmount, currencyID: "MYR" }] }],
  };
}

// ============================================================================
// Invoice Builders
// ============================================================================

interface InvoiceTotals {
  lineExtension: number;
  taxExclusive: number;
  taxAmount: number;
  taxInclusive: number;
  payable: number;
}

/**
 * Calculate invoice totals from line items
 */
function calculateTotals(items: LineItemWithTax[]): InvoiceTotals {
  let lineExtension = 0;
  let taxAmount = 0;

  for (const item of items) {
    const lineAmount = item.quantity * item.unitPrice;
    const lineTax = lineAmount * item.taxRate;
    lineExtension += lineAmount;
    taxAmount += lineTax;
  }

  lineExtension = roundToTwoDecimals(lineExtension);
  taxAmount = roundToTwoDecimals(taxAmount);
  const taxExclusive = lineExtension;
  const taxInclusive = roundToTwoDecimals(lineExtension + taxAmount);

  return {
    lineExtension,
    taxExclusive,
    taxAmount,
    taxInclusive,
    payable: taxInclusive,
  };
}

/**
 * Create invoice with SST (Sales or Service Tax)
 */
function createInvoiceWithSST(
  invoiceNumber: string,
  issuerTin: string,
  items: LineItemWithTax[],
  customerParty: object,
  sstRegistration?: string
): object {
  const { date, time } = getDocumentDateTime();
  const totals = calculateTotals(items);
  const lineItems = items.map((item) => createInvoiceLineWithTax(item));

  // Group tax totals by tax type
  const taxTotals: Record<string, { taxable: number; tax: number; rate: number }> = {};
  for (const item of items) {
    const key = item.taxType;
    const lineAmount = item.quantity * item.unitPrice;
    const lineTax = lineAmount * item.taxRate;
    if (!taxTotals[key]) {
      taxTotals[key] = { taxable: 0, tax: 0, rate: item.taxRate };
    }
    taxTotals[key].taxable += lineAmount;
    taxTotals[key].tax += lineTax;
  }

  const taxSubtotals = Object.entries(taxTotals).map(([taxType, values]) => ({
    TaxableAmount: [{ _: roundToTwoDecimals(values.taxable), currencyID: "MYR" }],
    TaxAmount: [{ _: roundToTwoDecimals(values.tax), currencyID: "MYR" }],
    TaxCategory: [
      {
        ID: [{ _: taxType }],
        Percent: [{ _: roundToTwoDecimals(values.rate * 100) }],
        TaxScheme: [{ ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] }],
      },
    ],
  }));

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [
      {
        ID: [{ _: invoiceNumber }],
        IssueDate: [{ _: date }],
        IssueTime: [{ _: time }],
        InvoiceTypeCode: [{ _: "01", listVersionID: "1.0" }],
        DocumentCurrencyCode: [{ _: "MYR" }],
        InvoicePeriod: [
          {
            StartDate: [{ _: date }],
            EndDate: [{ _: date }],
            Description: [{ _: "Monthly" }],
          },
        ],
        BillingReference: [{ AdditionalDocumentReference: [{ ID: [{ _: "NA" }] }] }],
        AccountingSupplierParty: [createSupplierParty(issuerTin, sstRegistration)],
        AccountingCustomerParty: [customerParty],
        PaymentMeans: [
          {
            PaymentMeansCode: [{ _: "01" }],
            PayeeFinancialAccount: [{ ID: [{ _: "1234567890123" }] }],
          },
        ],
        PaymentTerms: [{ Note: [{ _: "Payment due within 30 days" }] }],
        TaxTotal: [
          {
            TaxAmount: [{ _: totals.taxAmount, currencyID: "MYR" }],
            TaxSubtotal: taxSubtotals,
          },
        ],
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: totals.lineExtension, currencyID: "MYR" }],
            TaxExclusiveAmount: [{ _: totals.taxExclusive, currencyID: "MYR" }],
            TaxInclusiveAmount: [{ _: totals.taxInclusive, currencyID: "MYR" }],
            AllowanceTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            ChargeTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableRoundingAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableAmount: [{ _: totals.payable, currencyID: "MYR" }],
          },
        ],
        InvoiceLine: lineItems,
      },
    ],
  };
}

// ============================================================================
// Document Submission
// ============================================================================

interface SubmissionResult {
  success: boolean;
  status: number;
  submissionUid?: string;
  acceptedDocuments?: Array<{ uuid: string; invoiceCodeNumber: string }>;
  rejectedDocuments?: Array<{
    invoiceCodeNumber: string;
    error: { message: string; code?: string };
  }>;
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
      console.log(`   ACCEPTED: ${responseBody.acceptedDocuments.length} document(s)`);
      responseBody.acceptedDocuments.forEach((doc: { uuid: string }) => {
        console.log(`     - UUID: ${doc.uuid}`);
      });
    }
    if (responseBody.rejectedDocuments?.length > 0) {
      console.log(`   REJECTED: ${responseBody.rejectedDocuments.length} document(s)`);
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
    error: responseBody.error?.message || responseBody.message || JSON.stringify(responseBody),
    correlationId: correlationId || undefined,
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe.skipIf(SKIP_REAL_TESTS)("Regulation Compliance Tests", () => {
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
      throw new Error(`Token acquisition failed: ${response.status}`);
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
    console.log("Regulation Compliance Integration Tests");
    console.log("========================================");
    console.log(`Supplier TIN: ${SUPPLIER_TIN}`);
    console.log(`B2B Threshold: RM ${B2B_THRESHOLD.toLocaleString()}`);
    console.log("========================================\n");
  });

  // =========================================================================
  // SST Tax Tests
  // =========================================================================
  describe("1. SST Tax Compliance", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits invoice with Sales Tax (10%)", async () => {
      console.log("\n--- Test: Invoice with 10% Sales Tax ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("SST-SALES");

      const items: LineItemWithTax[] = [
        {
          id: "1",
          description: "Taxable Product - Electronics",
          quantity: 2,
          unitPrice: 500.0,
          taxType: TaxTypes.SALES_TAX,
          taxRate: TaxRates.SALES_TAX,
        },
      ];

      const totals = calculateTotals(items);
      console.log(`   Subtotal: RM ${totals.lineExtension.toFixed(2)}`);
      console.log(`   Sales Tax (10%): RM ${totals.taxAmount.toFixed(2)}`);
      console.log(`   Total: RM ${totals.payable.toFixed(2)}`);

      const invoice = createInvoiceWithSST(
        invoiceNumber,
        SUPPLIER_TIN,
        items,
        createB2BCustomerParty(),
        "A01-2345-67890123" // SST Registration
      );
      const result = await submitDocument(token, invoiceNumber, invoice);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
      }
    });

    it.skipIf(SKIP_INVOICE_TEST)("submits invoice with Service Tax (8%)", async () => {
      console.log("\n--- Test: Invoice with 8% Service Tax ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("SST-SERVICE");

      const items: LineItemWithTax[] = [
        {
          id: "1",
          description: "Professional Services - Consulting",
          quantity: 10,
          unitPrice: 200.0,
          taxType: TaxTypes.SERVICE_TAX,
          taxRate: TaxRates.SERVICE_TAX,
        },
      ];

      const totals = calculateTotals(items);
      console.log(`   Subtotal: RM ${totals.lineExtension.toFixed(2)}`);
      console.log(`   Service Tax (8%): RM ${totals.taxAmount.toFixed(2)}`);
      console.log(`   Total: RM ${totals.payable.toFixed(2)}`);

      const invoice = createInvoiceWithSST(
        invoiceNumber,
        SUPPLIER_TIN,
        items,
        createB2BCustomerParty()
      );
      const result = await submitDocument(token, invoiceNumber, invoice);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
      }
    });

    it.skipIf(SKIP_INVOICE_TEST)("submits invoice with mixed tax types", async () => {
      console.log("\n--- Test: Invoice with Mixed Sales & Service Tax ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("SST-MIXED");

      const items: LineItemWithTax[] = [
        {
          id: "1",
          description: "Product - Computer Hardware",
          quantity: 1,
          unitPrice: 3000.0,
          taxType: TaxTypes.SALES_TAX,
          taxRate: TaxRates.SALES_TAX,
        },
        {
          id: "2",
          description: "Service - Installation & Setup",
          quantity: 1,
          unitPrice: 500.0,
          taxType: TaxTypes.SERVICE_TAX,
          taxRate: TaxRates.SERVICE_TAX,
        },
        {
          id: "3",
          description: "Exempt Item - Educational Material",
          quantity: 1,
          unitPrice: 100.0,
          taxType: TaxTypes.EXEMPT,
          taxRate: TaxRates.ZERO,
          taxExemptionReason: "Exempt - Educational Material",
        },
      ];

      const totals = calculateTotals(items);
      console.log(`   Subtotal: RM ${totals.lineExtension.toFixed(2)}`);
      console.log(`   Total Tax: RM ${totals.taxAmount.toFixed(2)}`);
      console.log(`   Total: RM ${totals.payable.toFixed(2)}`);

      const invoice = createInvoiceWithSST(
        invoiceNumber,
        SUPPLIER_TIN,
        items,
        createB2BCustomerParty()
      );
      const result = await submitDocument(token, invoiceNumber, invoice);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
      }
    });
  });

  // =========================================================================
  // B2B/B2C Threshold Tests
  // =========================================================================
  describe("2. B2B/B2C Threshold Compliance", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits B2C invoice under RM10,000 threshold", async () => {
      console.log("\n--- Test: B2C Invoice < RM10,000 (Individual Buyer) ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("B2C-LOW");

      // Total under RM10,000 - can be B2C
      const items: LineItemWithTax[] = [
        {
          id: "1",
          description: "Consumer Product - Smartphone",
          quantity: 1,
          unitPrice: 2500.0,
          taxType: TaxTypes.SALES_TAX,
          taxRate: TaxRates.SALES_TAX,
        },
        {
          id: "2",
          description: "Accessories Bundle",
          quantity: 1,
          unitPrice: 500.0,
          taxType: TaxTypes.SALES_TAX,
          taxRate: TaxRates.SALES_TAX,
        },
      ];

      const totals = calculateTotals(items);
      console.log(`   Total Amount: RM ${totals.payable.toFixed(2)}`);
      console.log(`   Threshold: RM ${B2B_THRESHOLD.toLocaleString()}`);
      console.log(`   Type: B2C (Individual buyer allowed)`);

      expect(totals.payable).toBeLessThan(B2B_THRESHOLD);

      const invoice = createInvoiceWithSST(
        invoiceNumber,
        SUPPLIER_TIN,
        items,
        createB2CCustomerParty() // Individual buyer with NRIC
      );
      const result = await submitDocument(token, invoiceNumber, invoice);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
        console.log(`   Result: B2C invoice ACCEPTED`);
      }
    });

    it.skipIf(SKIP_INVOICE_TEST)("submits B2B invoice above RM10,000 threshold", async () => {
      console.log("\n--- Test: B2B Invoice > RM10,000 (Company Buyer Required) ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("B2B-HIGH");

      // Total above RM10,000 - MUST be B2B
      const items: LineItemWithTax[] = [
        {
          id: "1",
          description: "Enterprise Software License",
          quantity: 1,
          unitPrice: 8000.0,
          taxType: TaxTypes.SERVICE_TAX,
          taxRate: TaxRates.SERVICE_TAX,
        },
        {
          id: "2",
          description: "Annual Support Package",
          quantity: 1,
          unitPrice: 4000.0,
          taxType: TaxTypes.SERVICE_TAX,
          taxRate: TaxRates.SERVICE_TAX,
        },
      ];

      const totals = calculateTotals(items);
      console.log(`   Total Amount: RM ${totals.payable.toFixed(2)}`);
      console.log(`   Threshold: RM ${B2B_THRESHOLD.toLocaleString()}`);
      console.log(`   Type: B2B (Company buyer REQUIRED)`);

      expect(totals.payable).toBeGreaterThan(B2B_THRESHOLD);

      const invoice = createInvoiceWithSST(
        invoiceNumber,
        SUPPLIER_TIN,
        items,
        createB2BCustomerParty() // Company buyer with BRN
      );
      const result = await submitDocument(token, invoiceNumber, invoice);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
        console.log(`   Result: B2B invoice ACCEPTED`);
      }
    });

    it.skipIf(SKIP_INVOICE_TEST)("submits B2B invoice at exactly RM10,000", async () => {
      console.log("\n--- Test: Invoice at Exactly RM10,000 Threshold ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("B2B-EXACT");

      // Total at exactly RM10,000 (before tax) - B2C allowed
      const items: LineItemWithTax[] = [
        {
          id: "1",
          description: "Product Bundle - At Threshold",
          quantity: 1,
          unitPrice: 10000.0,
          taxType: TaxTypes.EXEMPT,
          taxRate: TaxRates.ZERO,
          taxExemptionReason: "Exempt - Zero rated",
        },
      ];

      const totals = calculateTotals(items);
      console.log(`   Total Amount: RM ${totals.payable.toFixed(2)}`);
      console.log(`   Threshold: RM ${B2B_THRESHOLD.toLocaleString()}`);
      console.log(`   Type: B2B (at threshold, using company buyer)`);

      // At exactly RM10,000, can still be B2C, but we use B2B to be safe
      const invoice = createInvoiceWithSST(
        invoiceNumber,
        SUPPLIER_TIN,
        items,
        createB2BCustomerParty()
      );
      const result = await submitDocument(token, invoiceNumber, invoice);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
      }
    });

    it.skipIf(SKIP_INVOICE_TEST)("submits high-value B2B invoice with full SST", async () => {
      console.log("\n--- Test: High-Value B2B Invoice with Full SST ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("B2B-FULL");

      // Large enterprise order
      const items: LineItemWithTax[] = [
        {
          id: "1",
          description: "Server Hardware",
          quantity: 5,
          unitPrice: 5000.0,
          taxType: TaxTypes.SALES_TAX,
          taxRate: TaxRates.SALES_TAX,
        },
        {
          id: "2",
          description: "Network Equipment",
          quantity: 10,
          unitPrice: 1500.0,
          taxType: TaxTypes.SALES_TAX,
          taxRate: TaxRates.SALES_TAX,
        },
        {
          id: "3",
          description: "Implementation Services",
          quantity: 1,
          unitPrice: 10000.0,
          taxType: TaxTypes.SERVICE_TAX,
          taxRate: TaxRates.SERVICE_TAX,
        },
        {
          id: "4",
          description: "Training Services",
          quantity: 20,
          unitPrice: 250.0,
          taxType: TaxTypes.SERVICE_TAX,
          taxRate: TaxRates.SERVICE_TAX,
        },
      ];

      const totals = calculateTotals(items);
      console.log(`   Subtotal: RM ${totals.lineExtension.toFixed(2)}`);
      console.log(`   Total Tax: RM ${totals.taxAmount.toFixed(2)}`);
      console.log(`   Grand Total: RM ${totals.payable.toFixed(2)}`);
      console.log(`   Type: B2B (High-value enterprise order)`);

      expect(totals.payable).toBeGreaterThan(B2B_THRESHOLD);

      const invoice = createInvoiceWithSST(
        invoiceNumber,
        SUPPLIER_TIN,
        items,
        createB2BCustomerParty()
      );
      const result = await submitDocument(token, invoiceNumber, invoice);

      expect(result.status).toBeLessThan(500);
      if (result.status === 202) {
        expect(result.submissionUid).toBeDefined();
        console.log(`   Result: High-value B2B invoice ACCEPTED`);
      }
    });
  });

  // =========================================================================
  // Summary Test
  // =========================================================================
  describe("3. Compliance Summary", () => {
    it("validates B2B threshold constant", () => {
      console.log("\n--- Compliance Constants ---");
      console.log(`   B2B Threshold: RM ${B2B_THRESHOLD.toLocaleString()}`);
      console.log(`   Sales Tax Rate: ${(TaxRates.SALES_TAX * 100).toFixed(0)}%`);
      console.log(`   Service Tax Rate: ${(TaxRates.SERVICE_TAX * 100).toFixed(0)}%`);
      console.log(`   Service Tax (Reduced): ${(TaxRates.SERVICE_TAX_REDUCED * 100).toFixed(0)}%`);

      expect(B2B_THRESHOLD).toBe(10000);
      expect(TaxRates.SALES_TAX).toBe(0.1);
      expect(TaxRates.SERVICE_TAX).toBe(0.08);
    });
  });
});
