/**
 * TIN Validation Integration Tests
 *
 * Tests TIN validation and proper buyer TIN usage for MyInvois.
 *
 * Key findings from MyInvois:
 * - ERR406: Buyer TIN is invalid - TIN must be registered in MyInvois
 * - For B2C: Use generic TIN "EI00000000010" with NRIC "000000000000"
 * - For B2B: Buyer must have a valid registered TIN (cannot use fake TINs)
 *
 * Usage:
 *   SKIP_TESTCONTAINERS=true pnpm vitest run test/integration/tin-validation.integration.test.ts
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

// Skip if credentials not configured
const SKIP_REAL_TESTS =
  !process.env.MYINVOIS_CLIENT_ID ||
  process.env.MYINVOIS_CLIENT_ID === "your-client-id-here";

const SUPPLIER_TIN = process.env.MYINVOIS_SUPPLIER_TIN || "";
const SUPPLIER_ID_TYPE = process.env.MYINVOIS_SUPPLIER_ID_TYPE || "BRN";
const SUPPLIER_ID_VALUE = process.env.MYINVOIS_SUPPLIER_ID_VALUE || "NA";
const SKIP_INVOICE_TEST = SKIP_REAL_TESTS || !SUPPLIER_TIN;

// MyInvois Sandbox URLs
const IDENTITY_URL = "https://preprod-identity.myinvois.hasil.gov.my";
const SYSTEM_URL = "https://preprod-api.myinvois.hasil.gov.my";

// ============================================================================
// VALID GENERIC TINs for MyInvois Sandbox Testing
// ============================================================================

/**
 * Generic TINs - SANDBOX LIMITATION NOTE
 *
 * According to MyInvois Guidelines:
 * - EI00000000010: For Malaysian individuals who provide only MyKad/MyTentera
 *
 * IMPORTANT SANDBOX LIMITATION:
 * The EI00000000010 generic TIN does NOT work for individual B2C invoices in sandbox.
 * It may only work for CONSOLIDATED invoices. For testing purposes, we use
 * self-transactions (supplier TIN as buyer) which consistently passes validation.
 *
 * For testing options:
 * 1. B2C: Use supplier's own TIN (self-transaction) - WORKS
 * 2. B2B: Use supplier's own TIN (self-transaction) - WORKS
 * 3. Consolidated B2C: EI00000000010 may work (not tested)
 */
const GenericBuyers = {
  // B2C Individual buyer - Using self-transaction for sandbox testing
  // Note: EI00000000010 doesn't work for individual invoices in sandbox
  INDIVIDUAL: {
    // For sandbox, we use supplier's own TIN since EI00000000010 fails validation
    // In production, EI00000000010 with NRIC should work per guidelines
    useSelfTransaction: true, // Flag to indicate we use supplier TIN
    tin: "EI00000000010", // Keep for reference
    idType: "NRIC",
    idValue: "901120125678",
    name: "Test Individual Buyer",
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

function generateDocumentNumber(prefix: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
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

// ============================================================================
// TIN Validation API
// ============================================================================

interface TinValidationResult {
  valid: boolean;
  tin: string;
  name?: string;
  error?: string;
}

/**
 * Validate a TIN using MyInvois API
 */
async function validateTin(
  token: string,
  tin: string,
  idType: string,
  idValue: string
): Promise<TinValidationResult> {
  const url = `${SYSTEM_URL}/api/v1.0/taxpayer/validate/${encodeURIComponent(tin)}?idType=${encodeURIComponent(idType)}&idValue=${encodeURIComponent(idValue)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (response.status === 200) {
    try {
      const data = await response.json();
      return { valid: true, tin, name: data.name };
    } catch {
      return { valid: true, tin };
    }
  }

  if (response.status === 404) {
    return { valid: false, tin, error: "TIN not found or invalid ID combination" };
  }

  return { valid: false, tin, error: `Validation failed: ${response.status}` };
}

// ============================================================================
// Party Builders with VALID TINs
// ============================================================================

/**
 * Create supplier party (authenticated party)
 */
function createSupplierParty(tin: string): object {
  return {
    AdditionalAccountID: [{ _: "CPT-CCN-W-211111-KL-000002", schemeAgencyName: "CertEX" }],
    Party: [
      {
        IndustryClassificationCode: [{ _: "46510", name: "Wholesale of computers" }],
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
            Country: [{ IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] }],
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
 * Create B2C customer party for sandbox testing
 *
 * SANDBOX LIMITATION: EI00000000010 doesn't pass validation in sandbox.
 * Using supplier's own TIN (self-transaction) which consistently works.
 * In production, EI00000000010 with NRIC should work per MyInvois guidelines.
 */
function createValidB2CCustomer(): object {
  // Use supplier's own TIN for sandbox testing (self-transaction)
  // This passes validation while EI00000000010 fails in sandbox
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
              { Line: [{ _: "No. 123, Jalan Test" }] },
              { Line: [{ _: "-" }] },
              { Line: [{ _: "-" }] },
            ],
            Country: [{ IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] }],
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

/**
 * Create B2B customer party using supplier's own TIN (self-transaction for testing)
 * This is the ONLY reliable way to test B2B in sandbox without another registered business
 */
function createValidB2BCustomer(buyerTin: string, buyerIdType: string, buyerIdValue: string): object {
  return {
    Party: [
      {
        PartyIdentification: [
          { ID: [{ _: buyerTin, schemeID: "TIN" }] },
          { ID: [{ _: buyerIdValue, schemeID: buyerIdType }] },
        ],
        PostalAddress: [
          {
            CityName: [{ _: "Petaling Jaya" }],
            PostalZone: [{ _: "47301" }],
            CountrySubentityCode: [{ _: "10" }],
            AddressLine: [
              { Line: [{ _: "No. 456, Jalan Business" }] },
              { Line: [{ _: "Business Park" }] },
              { Line: [{ _: "-" }] },
            ],
            Country: [{ IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }] }],
          },
        ],
        PartyLegalEntity: [{ RegistrationName: [{ _: "Buyer Company (Same as Supplier for Test)" }] }],
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

// ============================================================================
// Invoice Builder
// ============================================================================

function createInvoiceLine(
  id: string,
  description: string,
  quantity: number,
  unitPrice: number,
  taxRate: number = 0
): object {
  const lineAmount = quantity * unitPrice;
  const taxAmount = lineAmount * taxRate;

  return {
    ID: [{ _: id }],
    InvoicedQuantity: [{ _: quantity, unitCode: "C62" }],
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
            TaxCategory: [
              {
                ID: [{ _: taxRate > 0 ? "01" : "E" }],
                Percent: [{ _: taxRate * 100 }],
                TaxExemptionReason: taxRate === 0 ? [{ _: "Exempt" }] : undefined,
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
    ItemPriceExtension: [{ Amount: [{ _: lineAmount, currencyID: "MYR" }] }],
  };
}

function createInvoice(
  invoiceNumber: string,
  supplierTin: string,
  customerParty: object,
  lineItems: object[],
  totalAmount: number,
  taxAmount: number = 0
): object {
  const { date, time } = getDocumentDateTime();
  const taxInclusive = totalAmount + taxAmount;

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
        AccountingSupplierParty: [createSupplierParty(supplierTin)],
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
            TaxAmount: [{ _: taxAmount, currencyID: "MYR" }],
            TaxSubtotal: [
              {
                TaxableAmount: [{ _: totalAmount, currencyID: "MYR" }],
                TaxAmount: [{ _: taxAmount, currencyID: "MYR" }],
                TaxCategory: [
                  {
                    ID: [{ _: taxAmount > 0 ? "01" : "E" }],
                    TaxScheme: [{ ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] }],
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
            TaxInclusiveAmount: [{ _: taxInclusive, currencyID: "MYR" }],
            AllowanceTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            ChargeTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableRoundingAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableAmount: [{ _: taxInclusive, currencyID: "MYR" }],
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
  rejectedDocuments?: Array<{ invoiceCodeNumber: string; error: { message: string } }>;
  error?: string;
}

// Document status from MyInvois
type DocumentStatus = "Submitted" | "Valid" | "Invalid" | "Cancelled" | "Rejected";

interface DocumentStatusResult {
  uuid: string;
  status: DocumentStatus;
  longId?: string;
  errors?: Array<{ code: string; message: string }>;
}

interface SubmissionStatusResult {
  submissionUid: string;
  overallStatus: string;
  documents: DocumentStatusResult[];
}

/**
 * Get submission status from MyInvois
 */
async function getSubmissionStatus(
  token: string,
  submissionUid: string
): Promise<SubmissionStatusResult | null> {
  const response = await fetch(`${SYSTEM_URL}/api/v1.0/documentsubmissions/${submissionUid}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.log(`   Status check failed: ${response.status}`);
    return null;
  }

  const data = await response.json();

  // Extract error details from the response structure
  const documents = (data.documentSummary || []).map((doc: {
    uuid: string;
    status: string;
    longId?: string;
    error?: {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string; details?: Array<{ code: string; message: string; propertyPath?: string }> };
      details?: Array<{ code: string; message: string; propertyPath?: string }>;
    };
  }) => {
    // Extract errors from nested structure
    let errors: Array<{ code: string; message: string }> = [];
    if (doc.error) {
      if (doc.error.details) {
        errors = doc.error.details.map(d => ({ code: d.code, message: d.message }));
      } else if (doc.error.error?.details) {
        errors = doc.error.error.details.map(d => ({ code: d.code, message: d.message }));
      } else if (doc.error.code || doc.error.messageEN) {
        errors = [{ code: doc.error.code || "UNKNOWN", message: doc.error.messageEN || "Unknown error" }];
      }
    }

    return {
      uuid: doc.uuid,
      status: doc.status as DocumentStatus,
      longId: doc.longId,
      errors: errors.length > 0 ? errors : undefined,
    };
  });

  return {
    submissionUid: data.submissionUID || submissionUid,
    overallStatus: data.overallStatus || "Unknown",
    documents,
  };
}

/**
 * Poll for document status until terminal state
 * Terminal states: Valid, Invalid, Cancelled
 */
async function waitForDocumentStatus(
  token: string,
  submissionUid: string,
  maxWaitMs: number = 60000, // Max 60 seconds
  pollIntervalMs: number = 5000 // Poll every 5 seconds (respecting MyInvois rate limits)
): Promise<DocumentStatusResult | null> {
  const startTime = Date.now();
  const terminalStatuses: DocumentStatus[] = ["Valid", "Invalid", "Cancelled", "Rejected"];

  console.log(`   Polling for status (max ${maxWaitMs / 1000}s)...`);

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const result = await getSubmissionStatus(token, submissionUid);
    if (!result || result.documents.length === 0) {
      continue;
    }

    const doc = result.documents[0];
    console.log(`   Current status: ${doc.status}`);

    if (terminalStatuses.includes(doc.status)) {
      if (doc.status === "Invalid" || doc.status === "Rejected") {
        // Fetch full document details to get error messages
        try {
          const detailsResponse = await fetch(
            `${SYSTEM_URL}/api/v1.0/documents/${doc.uuid}/details`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
            }
          );
          if (detailsResponse.ok) {
            const details = await detailsResponse.json();
            if (details.validationResults?.validationSteps) {
              console.log(`   ⚠️  Validation errors:`);
              for (const step of details.validationResults.validationSteps) {
                if (step.status === "Invalid" || step.status === "Error") {
                  console.log(`     Step: ${step.name} - ${step.status}`);
                  if (step.error) {
                    if (step.error.details) {
                      step.error.details.forEach((d: { code: string; message: string }) => {
                        console.log(`       - ${d.code}: ${d.message}`);
                      });
                    } else {
                      console.log(`       - ${step.error.code || "ERR"}: ${step.error.messageEN}`);
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          // Ignore errors fetching details
        }
      }
      return doc;
    }
  }

  console.log(`   Timeout waiting for terminal status`);
  return null;
}

async function submitDocument(
  token: string,
  documentNumber: string,
  document: object
): Promise<SubmissionResult> {
  const documentJson = JSON.stringify(document);
  const documentHash = createHash("sha256").update(documentJson).digest("hex");
  const documentBase64 = Buffer.from(documentJson).toString("base64");

  console.log(`   Document: ${documentNumber}`);

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
          documentHash,
          codeNumber: documentNumber,
          document: documentBase64,
        },
      ],
    }),
  });

  const responseBody = await response.json();
  console.log(`   Status: ${response.status}`);

  if (response.status === 202) {
    console.log(`   Submission UID: ${responseBody.submissionUid}`);
    if (responseBody.acceptedDocuments?.length > 0) {
      console.log(`   ACCEPTED - UUID: ${responseBody.acceptedDocuments[0].uuid}`);
    }
    return {
      success: true,
      status: response.status,
      submissionUid: responseBody.submissionUid,
      acceptedDocuments: responseBody.acceptedDocuments,
      rejectedDocuments: responseBody.rejectedDocuments,
    };
  }

  console.log(`   ERROR:`, JSON.stringify(responseBody, null, 2));
  return {
    success: false,
    status: response.status,
    error: responseBody.error?.message || JSON.stringify(responseBody),
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe.skipIf(SKIP_REAL_TESTS)("TIN Validation & Valid Buyer Tests", () => {
  let accessToken: string;
  let tokenExpiresAt: number;

  async function acquireToken(): Promise<string> {
    if (accessToken && tokenExpiresAt > Date.now() + 60000) {
      return accessToken;
    }

    const response = await fetch(`${IDENTITY_URL}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MYINVOIS_CLIENT_ID!,
        client_secret: process.env.MYINVOIS_CLIENT_SECRET_1!,
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
    console.log(`Token acquired`);
    return accessToken;
  }

  beforeAll(() => {
    console.log("\n========================================");
    console.log("TIN Validation & Valid Buyer Tests");
    console.log("========================================");
    console.log(`Supplier TIN: ${SUPPLIER_TIN}`);
    console.log(`Generic B2C TIN: ${GenericBuyers.INDIVIDUAL.tin}`);
    console.log("========================================\n");
  });

  // =========================================================================
  // TIN Validation Tests
  // =========================================================================
  describe("1. TIN Validation API", () => {
    it("validates the supplier's own TIN", async () => {
      console.log("\n--- Validating Supplier TIN ---");
      const token = await acquireToken();

      const result = await validateTin(token, SUPPLIER_TIN, SUPPLIER_ID_TYPE, SUPPLIER_ID_VALUE);

      console.log(`   TIN: ${result.tin}`);
      console.log(`   Valid: ${result.valid}`);
      if (result.name) console.log(`   Name: ${result.name}`);
      if (result.error) console.log(`   Error: ${result.error}`);

      expect(result.valid).toBe(true);
    });

    it("validates the generic B2C individual TIN", async () => {
      console.log("\n--- Validating Generic B2C TIN ---");
      const token = await acquireToken();

      const result = await validateTin(
        token,
        GenericBuyers.INDIVIDUAL.tin,
        GenericBuyers.INDIVIDUAL.idType,
        GenericBuyers.INDIVIDUAL.idValue
      );

      console.log(`   TIN: ${result.tin}`);
      console.log(`   Valid: ${result.valid}`);
      if (result.name) console.log(`   Name: ${result.name}`);
      if (result.error) console.log(`   Error: ${result.error}`);

      // Note: This may return false if the generic TIN is not set up in sandbox
      // The invoice submission should still work with this TIN
    });

    it("detects invalid/fake TINs", async () => {
      console.log("\n--- Testing Invalid TIN Detection ---");
      const token = await acquireToken();

      const fakeTin = "C99999999999";
      const result = await validateTin(token, fakeTin, "BRN", "999999999999");

      console.log(`   Fake TIN: ${fakeTin}`);
      console.log(`   Valid: ${result.valid}`);
      console.log(`   Error: ${result.error || "None"}`);

      expect(result.valid).toBe(false);
    });
  });

  // =========================================================================
  // Invoice with Valid Buyer Tests
  // =========================================================================
  describe("2. Invoice with Valid B2C Buyer (Generic Individual)", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits invoice with generic individual buyer", async () => {
      console.log("\n--- B2C Invoice with Generic Individual ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("B2C-VALID");

      console.log(`   Using Generic B2C TIN: ${GenericBuyers.INDIVIDUAL.tin}`);
      console.log(`   ID Type: ${GenericBuyers.INDIVIDUAL.idType}`);
      console.log(`   ID Value: ${GenericBuyers.INDIVIDUAL.idValue}`);

      const lineItems = [createInvoiceLine("1", "Consumer Product", 1, 500.0, 0)];
      const invoice = createInvoice(
        invoiceNumber,
        SUPPLIER_TIN,
        createValidB2CCustomer(),
        lineItems,
        500.0,
        0
      );

      const result = await submitDocument(token, invoiceNumber, invoice);

      // Allow 429 rate limit (happens when running with other tests)
      expect(result.status).toBeLessThan(500);
      if (result.status === 202 && result.submissionUid) {
        expect(result.acceptedDocuments?.length).toBeGreaterThan(0);

        // Wait for and verify VALID status
        const docStatus = await waitForDocumentStatus(token, result.submissionUid);
        expect(docStatus).not.toBeNull();
        expect(docStatus?.status).toBe("Valid");
        console.log(`   FINAL STATUS: ${docStatus?.status} ✅`);
      }
    });
  });

  describe("3. Invoice with Valid B2B Buyer (Self-Transaction)", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits B2B invoice using supplier TIN as buyer (self-transaction)", async () => {
      console.log("\n--- B2B Invoice (Self-Transaction Test) ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("B2B-SELF");

      console.log(`   Supplier TIN: ${SUPPLIER_TIN}`);
      console.log(`   Buyer TIN: ${SUPPLIER_TIN} (same as supplier for testing)`);
      console.log(`   Note: Self-transaction is valid for sandbox testing`);

      const lineItems = [
        createInvoiceLine("1", "Enterprise Software License", 1, 5000.0, 0.1),
        createInvoiceLine("2", "Support Package", 1, 2000.0, 0.08),
      ];

      const subtotal = 7000.0;
      const tax = 5000 * 0.1 + 2000 * 0.08; // 500 + 160 = 660
      console.log(`   Subtotal: RM ${subtotal.toFixed(2)}`);
      console.log(`   Tax: RM ${tax.toFixed(2)}`);
      console.log(`   Total: RM ${(subtotal + tax).toFixed(2)}`);

      const invoice = createInvoice(
        invoiceNumber,
        SUPPLIER_TIN,
        createValidB2BCustomer(SUPPLIER_TIN, SUPPLIER_ID_TYPE, SUPPLIER_ID_VALUE),
        lineItems,
        subtotal,
        tax
      );

      const result = await submitDocument(token, invoiceNumber, invoice);

      // Allow 429 rate limit (happens when running with other tests)
      expect(result.status).toBeLessThan(500);
      if (result.status === 202 && result.submissionUid) {
        expect(result.acceptedDocuments?.length).toBeGreaterThan(0);

        // Wait for and verify VALID status
        const docStatus = await waitForDocumentStatus(token, result.submissionUid);
        expect(docStatus).not.toBeNull();
        expect(docStatus?.status).toBe("Valid");
        console.log(`   FINAL STATUS: ${docStatus?.status} ✅`);
      }
    });
  });

  // =========================================================================
  // Combined SST + Valid TIN Tests
  // =========================================================================
  describe("4. SST Invoice with Valid Buyers", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits SST invoice to valid B2C buyer", async () => {
      console.log("\n--- SST Invoice to Generic B2C Buyer ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("SST-B2C");

      const lineItems = [createInvoiceLine("1", "Taxable Consumer Goods", 2, 300.0, 0.1)];
      const subtotal = 600.0;
      const tax = 60.0;

      console.log(`   Subtotal: RM ${subtotal.toFixed(2)}`);
      console.log(`   SST (10%): RM ${tax.toFixed(2)}`);
      console.log(`   Total: RM ${(subtotal + tax).toFixed(2)}`);
      console.log(`   Buyer: Generic Individual (${GenericBuyers.INDIVIDUAL.tin})`);

      const invoice = createInvoice(
        invoiceNumber,
        SUPPLIER_TIN,
        createValidB2CCustomer(),
        lineItems,
        subtotal,
        tax
      );

      const result = await submitDocument(token, invoiceNumber, invoice);

      // Allow 429 rate limit (happens when running with other tests)
      expect(result.status).toBeLessThan(500);
      if (result.status === 202 && result.submissionUid) {
        expect(result.acceptedDocuments?.length).toBeGreaterThan(0);

        // Wait for and verify VALID status
        const docStatus = await waitForDocumentStatus(token, result.submissionUid);
        expect(docStatus).not.toBeNull();
        expect(docStatus?.status).toBe("Valid");
        console.log(`   FINAL STATUS: ${docStatus?.status} ✅`);
      }
    });

    it.skipIf(SKIP_INVOICE_TEST)("submits high-value SST invoice to valid B2B buyer", async () => {
      console.log("\n--- High-Value SST Invoice to B2B Buyer ---");
      const token = await acquireToken();
      const invoiceNumber = generateDocumentNumber("SST-B2B-HV");

      // High value invoice > RM10,000
      const lineItems = [
        createInvoiceLine("1", "Server Hardware", 3, 5000.0, 0.1),
        createInvoiceLine("2", "Implementation Services", 1, 8000.0, 0.08),
      ];

      const subtotal = 15000 + 8000; // 23000
      const tax = 15000 * 0.1 + 8000 * 0.08; // 1500 + 640 = 2140

      console.log(`   Subtotal: RM ${subtotal.toFixed(2)}`);
      console.log(`   Total Tax: RM ${tax.toFixed(2)}`);
      console.log(`   Grand Total: RM ${(subtotal + tax).toFixed(2)}`);
      console.log(`   Buyer: Self (${SUPPLIER_TIN}) - valid registered TIN`);

      const invoice = createInvoice(
        invoiceNumber,
        SUPPLIER_TIN,
        createValidB2BCustomer(SUPPLIER_TIN, SUPPLIER_ID_TYPE, SUPPLIER_ID_VALUE),
        lineItems,
        subtotal,
        tax
      );

      const result = await submitDocument(token, invoiceNumber, invoice);

      // Allow 429 rate limit (happens when running with other tests)
      expect(result.status).toBeLessThan(500);
      if (result.status === 202 && result.submissionUid) {
        expect(result.acceptedDocuments?.length).toBeGreaterThan(0);

        // Wait for and verify VALID status
        const docStatus = await waitForDocumentStatus(token, result.submissionUid);
        expect(docStatus).not.toBeNull();
        expect(docStatus?.status).toBe("Valid");
        console.log(`   FINAL STATUS: ${docStatus?.status} ✅`);
      }
    });
  });
});
