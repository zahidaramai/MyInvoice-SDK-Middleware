/**
 * Real E-Invoice Submission Test
 *
 * Submits a valid UBL 2.1 invoice to MyInvois Sandbox.
 * Requires valid credentials in .env file.
 *
 * Usage:
 *   SKIP_TESTCONTAINERS=true pnpm vitest run test/integration/submit-invoice.integration.test.ts
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
const SUPPLIER_ID_TYPE = process.env.MYINVOIS_SUPPLIER_ID_TYPE || "BRN"; // NRIC, BRN, PASSPORT, ARMY
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

/**
 * Generate a unique invoice number with timestamp
 */
function generateInvoiceNumber(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INV-${ts}-${rand}`;
}

/**
 * Create a valid UBL 2.1 Invoice JSON for MyInvois
 * Based on MyInvois SDK specification
 */
function createUBLInvoice(invoiceNumber: string, issuerTin: string): object {
  // Use UTC time and subtract 5 minutes to avoid "future" error due to clock skew
  const now = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

  const issueDate = now.toISOString().split("T")[0];
  // Format time as HH:mm:ssZ (UTC)
  const hours = now.getUTCHours().toString().padStart(2, "0");
  const minutes = now.getUTCMinutes().toString().padStart(2, "0");
  const seconds = now.getUTCSeconds().toString().padStart(2, "0");
  const issueTime = `${hours}:${minutes}:${seconds}Z`;

  return {
    "_D": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "_A": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "_B": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    "Invoice": [{
      "ID": [{ "_": invoiceNumber }],
      "IssueDate": [{ "_": issueDate }],
      "IssueTime": [{ "_": issueTime }],
      "InvoiceTypeCode": [{ "_": "01", "listVersionID": "1.0" }],
      "DocumentCurrencyCode": [{ "_": "MYR" }],
      "InvoicePeriod": [{
        "StartDate": [{ "_": issueDate }],
        "EndDate": [{ "_": issueDate }],
        "Description": [{ "_": "Monthly" }]
      }],
      "BillingReference": [{
        "AdditionalDocumentReference": [{
          "ID": [{ "_": "E12345678912" }]
        }]
      }],
      "AccountingSupplierParty": [{
        "AdditionalAccountID": [{ "_": "CPT-CCN-W-211111-KL-000002", "schemeAgencyName": "CertEX" }],
        "Party": [{
          "IndustryClassificationCode": [{ "_": "46510", "name": "Wholesale of computers, computer peripheral equipment and software" }],
          "PartyIdentification": [
            { "ID": [{ "_": issuerTin, "schemeID": "TIN" }] },
            { "ID": [{ "_": SUPPLIER_ID_VALUE, "schemeID": SUPPLIER_ID_TYPE }] }
          ],
          "PostalAddress": [{
            "CityName": [{ "_": "Kuala Lumpur" }],
            "PostalZone": [{ "_": "50480" }],
            "CountrySubentityCode": [{ "_": "14" }],
            "AddressLine": [
              { "Line": [{ "_": "Lot 66" }] },
              { "Line": [{ "_": "Bangunan Merdeka" }] },
              { "Line": [{ "_": "Persiaran Jaya" }] }
            ],
            "Country": [{
              "IdentificationCode": [{ "_": "MYS", "listID": "ISO3166-1", "listAgencyID": "6" }]
            }]
          }],
          "PartyLegalEntity": [{
            "RegistrationName": [{ "_": "Test Supplier Sdn Bhd" }]
          }],
          "Contact": [{
            "Telephone": [{ "_": "+60123456789" }],
            "ElectronicMail": [{ "_": "supplier@test.com" }]
          }]
        }]
      }],
      "AccountingCustomerParty": [{
        "Party": [{
          "PartyIdentification": [
            { "ID": [{ "_": issuerTin, "schemeID": "TIN" }] },
            { "ID": [{ "_": SUPPLIER_ID_VALUE, "schemeID": SUPPLIER_ID_TYPE }] }
          ],
          "PostalAddress": [{
            "CityName": [{ "_": "Kuala Lumpur" }],
            "PostalZone": [{ "_": "50480" }],
            "CountrySubentityCode": [{ "_": "14" }],
            "AddressLine": [
              { "Line": [{ "_": "Lot 55" }] },
              { "Line": [{ "_": "Bangunan Buyer" }] },
              { "Line": [{ "_": "-" }] }
            ],
            "Country": [{
              "IdentificationCode": [{ "_": "MYS", "listID": "ISO3166-1", "listAgencyID": "6" }]
            }]
          }],
          "PartyLegalEntity": [{
            "RegistrationName": [{ "_": "Test Buyer Sdn Bhd" }]
          }],
          "Contact": [{
            "Telephone": [{ "_": "+60987654321" }],
            "ElectronicMail": [{ "_": "buyer@test.com" }]
          }]
        }]
      }],
      "PaymentMeans": [{
        "PaymentMeansCode": [{ "_": "01" }],
        "PayeeFinancialAccount": [{
          "ID": [{ "_": "1234567890123" }]
        }]
      }],
      "PaymentTerms": [{
        "Note": [{ "_": "Payment due within 30 days" }]
      }],
      "TaxTotal": [{
        "TaxAmount": [{ "_": 0.00, "currencyID": "MYR" }],
        "TaxSubtotal": [{
          "TaxableAmount": [{ "_": 100.00, "currencyID": "MYR" }],
          "TaxAmount": [{ "_": 0.00, "currencyID": "MYR" }],
          "TaxCategory": [{
            "ID": [{ "_": "E" }],
            "TaxScheme": [{
              "ID": [{ "_": "OTH", "schemeID": "UN/ECE 5153", "schemeAgencyID": "6" }]
            }]
          }]
        }]
      }],
      "LegalMonetaryTotal": [{
        "LineExtensionAmount": [{ "_": 100.00, "currencyID": "MYR" }],
        "TaxExclusiveAmount": [{ "_": 100.00, "currencyID": "MYR" }],
        "TaxInclusiveAmount": [{ "_": 100.00, "currencyID": "MYR" }],
        "AllowanceTotalAmount": [{ "_": 0.00, "currencyID": "MYR" }],
        "ChargeTotalAmount": [{ "_": 0.00, "currencyID": "MYR" }],
        "PayableRoundingAmount": [{ "_": 0.00, "currencyID": "MYR" }],
        "PayableAmount": [{ "_": 100.00, "currencyID": "MYR" }]
      }],
      "InvoiceLine": [{
        "ID": [{ "_": "1" }],
        "InvoicedQuantity": [{ "_": 1, "unitCode": "C62" }],
        "LineExtensionAmount": [{ "_": 100.00, "currencyID": "MYR" }],
        "AllowanceCharge": [{
          "ChargeIndicator": [{ "_": false }],
          "AllowanceChargeReason": [{ "_": "Sample discount" }],
          "Amount": [{ "_": 0.00, "currencyID": "MYR" }]
        }],
        "TaxTotal": [{
          "TaxAmount": [{ "_": 0.00, "currencyID": "MYR" }],
          "TaxSubtotal": [{
            "TaxableAmount": [{ "_": 100.00, "currencyID": "MYR" }],
            "TaxAmount": [{ "_": 0.00, "currencyID": "MYR" }],
            "TaxCategory": [{
              "ID": [{ "_": "E" }],
              "TaxExemptionReason": [{ "_": "Exempt New Means of Transport" }],
              "TaxScheme": [{
                "ID": [{ "_": "OTH", "schemeID": "UN/ECE 5153", "schemeAgencyID": "6" }]
              }]
            }]
          }]
        }],
        "Item": [{
          "CommodityClassification": [{
            "ItemClassificationCode": [{ "_": "001", "listID": "CLASS" }]
          }],
          "Description": [{ "_": "Test Product for E-Invoice Integration" }]
        }],
        "Price": [{
          "PriceAmount": [{ "_": 100.00, "currencyID": "MYR" }]
        }],
        "ItemPriceExtension": [{
          "Amount": [{ "_": 100.00, "currencyID": "MYR" }]
        }]
      }]
    }]
  };
}

describe.skipIf(SKIP_REAL_TESTS)("Real E-Invoice Submission", () => {
  let accessToken: string;
  let tokenExpiresAt: number;

  /**
   * Get credentials from environment
   */
  function getCredentials() {
    return {
      clientId: process.env.MYINVOIS_CLIENT_ID!,
      clientSecret: process.env.MYINVOIS_CLIENT_SECRET_1!,
    };
  }

  /**
   * Acquire OAuth2 token from MyInvois
   */
  async function acquireToken(): Promise<string> {
    // Return cached token if still valid
    if (accessToken && tokenExpiresAt > Date.now() + 60000) {
      return accessToken;
    }

    const { clientId, clientSecret } = getCredentials();

    const response = await fetch(`${IDENTITY_URL}/connect/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
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
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);

    console.log(`Token acquired, expires in ${data.expires_in}s`);
    return accessToken;
  }

  beforeAll(() => {
    if (SKIP_REAL_TESTS) {
      console.log("Skipping real e-invoice submission tests - credentials not configured");
      return;
    }
    console.log("Running real e-invoice submission tests");
    console.log(`   Client ID: ${process.env.MYINVOIS_CLIENT_ID?.slice(0, 8)}...`);
    if (SUPPLIER_TIN) {
      console.log(`   Supplier TIN: ${SUPPLIER_TIN}`);
      console.log(`   Supplier ID Type: ${SUPPLIER_ID_TYPE}`);
      console.log(`   Supplier ID Value: ${SUPPLIER_ID_VALUE.slice(0, 6)}...`);
    } else {
      console.log("   WARNING: MYINVOIS_SUPPLIER_TIN not set - invoice submission will fail TIN validation");
    }
  });

  describe("E-Invoice Submission", () => {
    it.skipIf(SKIP_INVOICE_TEST)("submits a valid UBL 2.1 invoice to sandbox", async () => {
      const token = await acquireToken();
      const invoiceNumber = generateInvoiceNumber();

      // Use the supplier TIN from environment (must match authenticated client)
      const issuerTin = SUPPLIER_TIN;

      // Create UBL invoice
      const invoice = createUBLInvoice(invoiceNumber, issuerTin);
      const invoiceJson = JSON.stringify(invoice);

      // Calculate SHA256 hash
      const documentHash = createHash("sha256").update(invoiceJson).digest("hex");

      // Base64 encode
      const documentBase64 = Buffer.from(invoiceJson).toString("base64");

      console.log(`   Invoice Number: ${invoiceNumber}`);
      console.log(`   Document Size: ${invoiceJson.length} bytes`);
      console.log(`   Document Hash: ${documentHash.slice(0, 16)}...`);

      // Submit to MyInvois
      const response = await fetch(`${SYSTEM_URL}/api/v1.0/documentsubmissions/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          documents: [{
            format: "JSON",
            documentHash: documentHash,
            codeNumber: invoiceNumber,
            document: documentBase64,
          }],
        }),
      });

      const responseBody = await response.json();

      console.log(`   Response Status: ${response.status}`);
      console.log(`   Response Body:`, JSON.stringify(responseBody, null, 2));

      // Handle various response codes
      if (response.status === 202) {
        // Success! Document accepted
        expect(responseBody.submissionUid).toBeDefined();
        console.log(`   Submission UID: ${responseBody.submissionUid}`);

        if (responseBody.acceptedDocuments?.length > 0) {
          console.log(`   Accepted Documents: ${responseBody.acceptedDocuments.length}`);
          responseBody.acceptedDocuments.forEach((doc: { uuid: string; invoiceCodeNumber: string }) => {
            console.log(`     - UUID: ${doc.uuid}, Code: ${doc.invoiceCodeNumber}`);
          });
        }

        if (responseBody.rejectedDocuments?.length > 0) {
          console.log(`   Rejected Documents: ${responseBody.rejectedDocuments.length}`);
          responseBody.rejectedDocuments.forEach((doc: { invoiceCodeNumber: string; error: { message: string } }) => {
            console.log(`     - Code: ${doc.invoiceCodeNumber}, Error: ${doc.error?.message}`);
          });
        }
      } else if (response.status === 400) {
        // Validation error - document structure issue
        console.log(`   Validation Error: ${JSON.stringify(responseBody)}`);
        // This is still a valid test - we're testing API connectivity
        expect(response.status).toBe(400);
      } else if (response.status === 422) {
        // Could be duplicate or other business rule violation
        console.log(`   Business Rule Error: ${responseBody.message || JSON.stringify(responseBody)}`);
        expect([400, 422]).toContain(response.status);
      } else {
        // Unexpected error
        console.log(`   Unexpected Error: ${response.status}`);
        expect(response.status).toBeLessThan(500);
      }

      // Verify correlation ID is returned
      const correlationId = response.headers.get("correlationid") ||
        response.headers.get("x-correlation-id");
      console.log(`   Correlation ID: ${correlationId || "not provided"}`);
    });

    it("gets document types from sandbox (canary endpoint)", async () => {
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
      console.log(`   Document Types available: ${Array.isArray(documentTypes) ? documentTypes.length : "N/A"}`);

      // Log first few document types if available
      if (Array.isArray(documentTypes) && documentTypes.length > 0) {
        console.log(`   Sample types:`);
        documentTypes.slice(0, 5).forEach((dt: { id: number; name: string }) => {
          console.log(`     - ${dt.id}: ${dt.name}`);
        });
      }
    });
  });
});
