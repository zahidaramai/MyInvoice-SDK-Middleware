/**
 * Issue an invoice to MyInvois
 * Usage: pnpm tsx scripts/issue-invoice.ts [amount]
 * Default amount: RM 1.00
 */

import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { SigningService, loadPKCS12 } from "../packages/signing/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env") });

// Environment-based configuration
const MYINVOIS_ENV = process.env.MYINVOIS_ENV || "SANDBOX";
const BASE_URL = MYINVOIS_ENV === "PROD"
  ? "https://api.myinvois.hasil.gov.my"
  : "https://preprod-api.myinvois.hasil.gov.my";

const CLIENT_ID = process.env.MYINVOIS_CLIENT_ID!;
const CLIENT_SECRET = process.env.MYINVOIS_CLIENT_SECRET_1!;
const SUPPLIER_TIN = process.env.MYINVOIS_SUPPLIER_TIN!;
const SUPPLIER_ID_TYPE = process.env.MYINVOIS_SUPPLIER_ID_TYPE || "BRN";
const SUPPLIER_ID_VALUE = process.env.MYINVOIS_SUPPLIER_ID_VALUE!;

// Parse amount from command line or default to 1.00
const amount = parseFloat(process.argv[2] || "1.00");

function createInvoice(invNum: string, invoiceAmount: number) {
  const today = new Date().toISOString().split("T")[0];
  const timeNow = new Date().toISOString().split("T")[1].substring(0, 8) + "Z";

  return {
    "_D": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "_A": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "_B": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    "Invoice": [{
      "ID": [{ "_": invNum }],
      "IssueDate": [{ "_": today }],
      "IssueTime": [{ "_": timeNow }],
      "InvoiceTypeCode": [{ "_": "01", "listVersionID": "1.1" }],
      "DocumentCurrencyCode": [{ "_": "MYR" }],
      "AccountingSupplierParty": [{
        "Party": [{
          "IndustryClassificationCode": [{ "_": "62010", "name": "Computer programming activities" }],
          "PartyIdentification": [{
            "ID": [{ "_": SUPPLIER_TIN, "schemeID": "TIN" }]
          }, {
            "ID": [{ "_": SUPPLIER_ID_VALUE, "schemeID": SUPPLIER_ID_TYPE }]
          }],
          "PartyLegalEntity": [{
            "RegistrationName": [{ "_": "SUPPLIER COMPANY" }]
          }],
          "PostalAddress": [{
            "AddressLine": [{ "Line": [{ "_": "Address Line 1" }] }],
            "CityName": [{ "_": "Kuala Lumpur" }],
            "PostalZone": [{ "_": "50000" }],
            "CountrySubentityCode": [{ "_": "14" }],
            "Country": [{
              "IdentificationCode": [{ "_": "MYS", "listID": "ISO3166-1", "listAgencyID": "6" }]
            }]
          }],
          "Contact": [{
            "Telephone": [{ "_": "+60300000000" }],
            "ElectronicMail": [{ "_": "supplier@example.com" }]
          }]
        }]
      }],
      "AccountingCustomerParty": [{
        "Party": [{
          "PartyIdentification": [{
            "ID": [{ "_": "EI00000000010", "schemeID": "TIN" }]
          }, {
            "ID": [{ "_": "000000000000", "schemeID": "NRIC" }]
          }],
          "PartyLegalEntity": [{
            "RegistrationName": [{ "_": "GENERAL PUBLIC" }]
          }],
          "PostalAddress": [{
            "AddressLine": [{ "Line": [{ "_": "Customer Address" }] }],
            "CityName": [{ "_": "Kuala Lumpur" }],
            "PostalZone": [{ "_": "50000" }],
            "CountrySubentityCode": [{ "_": "14" }],
            "Country": [{
              "IdentificationCode": [{ "_": "MYS", "listID": "ISO3166-1", "listAgencyID": "6" }]
            }]
          }],
          "Contact": [{
            "Telephone": [{ "_": "+60300000001" }]
          }]
        }]
      }],
      "LegalMonetaryTotal": [{
        "LineExtensionAmount": [{ "_": invoiceAmount, "currencyID": "MYR" }],
        "TaxExclusiveAmount": [{ "_": invoiceAmount, "currencyID": "MYR" }],
        "TaxInclusiveAmount": [{ "_": invoiceAmount, "currencyID": "MYR" }],
        "PayableAmount": [{ "_": invoiceAmount, "currencyID": "MYR" }]
      }],
      "TaxTotal": [{
        "TaxAmount": [{ "_": 0.00, "currencyID": "MYR" }],
        "TaxSubtotal": [{
          "TaxableAmount": [{ "_": invoiceAmount, "currencyID": "MYR" }],
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
      "InvoiceLine": [{
        "ID": [{ "_": "1" }],
        "InvoicedQuantity": [{ "_": 1, "unitCode": "C62" }],
        "LineExtensionAmount": [{ "_": invoiceAmount, "currencyID": "MYR" }],
        "TaxTotal": [{
          "TaxAmount": [{ "_": 0.00, "currencyID": "MYR" }],
          "TaxSubtotal": [{
            "TaxableAmount": [{ "_": invoiceAmount, "currencyID": "MYR" }],
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
          "Description": [{ "_": `Service Item RM${invoiceAmount.toFixed(2)}` }],
          "CommodityClassification": [{
            "ItemClassificationCode": [{ "_": "001", "listID": "CLASS" }]
          }]
        }],
        "Price": [{
          "PriceAmount": [{ "_": invoiceAmount, "currencyID": "MYR" }]
        }],
        "ItemPriceExtension": [{
          "Amount": [{ "_": invoiceAmount, "currencyID": "MYR" }]
        }]
      }]
    }]
  };
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getToken(): Promise<string> {
  console.log("Getting token...");
  const resp = await fetch(`${BASE_URL}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "InvoicingAPI"
    })
  });

  const data = await resp.json() as any;
  if (!data.access_token) {
    console.error("Token error:", data);
    throw new Error("Failed to get token");
  }
  return data.access_token;
}

async function pollSubmission(token: string, submissionUid: string): Promise<string> {
  console.log("\nPolling for validation...");

  for (let i = 0; i < 40; i++) {
    await sleep(3000);

    const resp = await fetch(`${BASE_URL}/api/v1.0/documentsubmissions/${submissionUid}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    });

    const data = await resp.json() as any;
    const status = data.overallStatus?.toLowerCase();

    process.stdout.write(`  Poll ${i + 1}: ${data.overallStatus}\r`);

    if (status === "valid") {
      console.log(`\n  Status: VALID`);
      return "Valid";
    }
    if (status === "invalid") {
      console.log(`\n  Status: INVALID`);
      console.log("  Errors:", JSON.stringify(data, null, 2));
      return "Invalid";
    }
    if (status === "partially valid") {
      console.log(`\n  Status: PARTIALLY VALID`);
      return "Partially Valid";
    }
  }

  return "Timeout";
}

async function main() {
  console.log("=".repeat(50));
  console.log(`  MyInvois Invoice Submission (${MYINVOIS_ENV})`);
  console.log("=".repeat(50));
  console.log(`  Amount: RM ${amount.toFixed(2)}`);
  console.log(`  Environment: ${MYINVOIS_ENV}`);
  console.log(`  API: ${BASE_URL}`);
  console.log("");

  // Validate environment
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("ERROR: Missing MYINVOIS_CLIENT_ID or MYINVOIS_CLIENT_SECRET_1");
    process.exit(1);
  }

  // Load certificate
  const p12Path = process.env.SIGNING_PKCS12_PATH!;
  const p12Pass = process.env.SIGNING_PKCS12_PASSPHRASE!;

  if (!p12Path) {
    console.error("ERROR: Missing SIGNING_PKCS12_PATH");
    process.exit(1);
  }

  console.log("Loading certificate...");
  const p12 = loadPKCS12({ path: p12Path, passphrase: p12Pass });
  console.log("  Certificate:", p12.certInfo.subject.CN || p12.certInfo.subject.raw);

  // Create invoice
  const invNum = `INV-${Date.now()}`;
  const invoice = createInvoice(invNum, amount);
  console.log(`\nInvoice: ${invNum}`);

  // Sign
  console.log("Signing document...");
  const signer = new SigningService(p12.privateKey, p12.certPem, p12.certInfo);
  const result = signer.sign(invoice);

  const signedDocJson = JSON.stringify(result.signedDocument);
  const signedDocBase64 = Buffer.from(signedDocJson, "utf-8").toString("base64");
  const docHash = createHash("sha256").update(signedDocJson, "utf-8").digest("hex");

  console.log("  Document hash:", docHash.substring(0, 32) + "...");

  // Get token
  const token = await getToken();
  console.log("  Token: OK");

  // Submit
  console.log("\nSubmitting to MyInvois...");
  const submitResp = await fetch(`${BASE_URL}/api/v1.0/documentsubmissions/`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      documents: [{
        format: "JSON",
        document: signedDocBase64,
        documentHash: docHash,
        codeNumber: invNum
      }]
    })
  });

  const submitData = await submitResp.json() as any;

  if (submitResp.status !== 202) {
    console.error("Submission failed:", submitResp.status);
    console.error(JSON.stringify(submitData, null, 2));
    process.exit(1);
  }

  const submissionUid = submitData.submissionUid;
  const docUuid = submitData.acceptedDocuments?.[0]?.uuid;

  console.log("  Submission UID:", submissionUid);
  console.log("  Document UUID:", docUuid);

  // Poll
  const finalStatus = await pollSubmission(token, submissionUid);

  // Get document details
  if (docUuid && finalStatus === "Valid") {
    const detailsResp = await fetch(`${BASE_URL}/api/v1.0/documents/${docUuid}/details`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    });
    const details = await detailsResp.json() as any;

    console.log("\n" + "=".repeat(50));
    console.log("  INVOICE ISSUED SUCCESSFULLY");
    console.log("=".repeat(50));
    console.log(`  Invoice Number: ${invNum}`);
    console.log(`  Amount: RM ${amount.toFixed(2)}`);
    console.log(`  UUID: ${docUuid}`);
    console.log(`  Long ID: ${details.longId || "(pending)"}`);
    console.log(`  Status: ${details.status}`);
    console.log("=".repeat(50));
  } else {
    console.log("\n" + "=".repeat(50));
    console.log(`  Final Status: ${finalStatus}`);
    console.log("=".repeat(50));
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
