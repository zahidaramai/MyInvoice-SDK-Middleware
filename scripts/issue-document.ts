/**
 * Issue any MyInvois document type
 *
 * Usage:
 *   pnpm tsx scripts/issue-document.ts --type invoice --amount 100
 *   pnpm tsx scripts/issue-document.ts --type credit-note --amount 50 --ref-id INV-123 --ref-uuid abc-def
 *   pnpm tsx scripts/issue-document.ts --type self-billed-invoice --amount 200
 *
 * Document Types:
 *   invoice (01)              - Standard invoice
 *   consolidated (01)         - Consolidated invoice (buyer TIN: EI00000000010)
 *   credit-note (02)          - Credit note (requires --ref-id and --ref-uuid)
 *   debit-note (03)           - Debit note (requires --ref-id and --ref-uuid)
 *   refund-note (04)          - Refund note (requires --ref-id and --ref-uuid)
 *   self-billed-invoice (11)  - Self-billed invoice
 *   self-billed-credit (12)   - Self-billed credit note (requires --ref-id and --ref-uuid)
 *   self-billed-debit (13)    - Self-billed debit note (requires --ref-id and --ref-uuid)
 *   self-billed-refund (14)   - Self-billed refund note (requires --ref-id and --ref-uuid)
 *
 * Options:
 *   --type, -t         Document type (default: invoice)
 *   --amount, -a       Amount in MYR (default: 1.00)
 *   --version, -v      Document version: 1.0 or 1.1 (default: 1.1)
 *   --buyer-tin        Buyer TIN (default: EI00000000010 for general public)
 *   --buyer-id         Buyer ID value (default: 000000000000)
 *   --buyer-id-type    Buyer ID type: NRIC, PASSPORT, BRN, ARMY (default: NRIC)
 *   --buyer-name       Buyer name (default: GENERAL PUBLIC)
 *   --ref-id           Reference invoice ID (for credit/debit/refund notes)
 *   --ref-uuid         Reference invoice UUID (for credit/debit/refund notes)
 */

import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { SigningService, loadPKCS12 } from "../packages/signing/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env") });

// Document type codes
const DOCUMENT_TYPES = {
  "invoice": "01",
  "consolidated": "01",
  "credit-note": "02",
  "debit-note": "03",
  "refund-note": "04",
  "self-billed-invoice": "11",
  "self-billed-credit": "12",
  "self-billed-debit": "13",
  "self-billed-refund": "14"
} as const;

type DocumentType = keyof typeof DOCUMENT_TYPES;

// Document type prefixes for code numbers
const DOCUMENT_PREFIXES: Record<DocumentType, string> = {
  "invoice": "INV",
  "consolidated": "CINV",
  "credit-note": "CN",
  "debit-note": "DN",
  "refund-note": "RN",
  "self-billed-invoice": "SBINV",
  "self-billed-credit": "SBCN",
  "self-billed-debit": "SBDN",
  "self-billed-refund": "SBRN"
};

// Documents requiring billing reference
const REQUIRES_REFERENCE: DocumentType[] = [
  "credit-note",
  "debit-note",
  "refund-note",
  "self-billed-credit",
  "self-billed-debit",
  "self-billed-refund"
];

// Environment configuration
const MYINVOIS_ENV = process.env.MYINVOIS_ENV || "SANDBOX";
const BASE_URL = MYINVOIS_ENV === "PROD"
  ? "https://api.myinvois.hasil.gov.my"
  : "https://preprod-api.myinvois.hasil.gov.my";

const CLIENT_ID = process.env.MYINVOIS_CLIENT_ID!;
const CLIENT_SECRET = process.env.MYINVOIS_CLIENT_SECRET_1!;
const SUPPLIER_TIN = process.env.MYINVOIS_SUPPLIER_TIN!;
const SUPPLIER_ID_TYPE = process.env.MYINVOIS_SUPPLIER_ID_TYPE || "BRN";
const SUPPLIER_ID_VALUE = process.env.MYINVOIS_SUPPLIER_ID_VALUE!;

// Parse CLI arguments
interface Args {
  type: DocumentType;
  amount: number;
  version: "1.0" | "1.1";
  buyerTin: string;
  buyerId: string;
  buyerIdType: string;
  buyerName: string;
  refId?: string;
  refUuid?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  // Default to self-invoicing (supplier = buyer) for testing
  const result: Args = {
    type: "invoice",
    amount: 1.00,
    version: "1.1",
    buyerTin: SUPPLIER_TIN,  // Use supplier TIN as default buyer for testing
    buyerId: SUPPLIER_ID_VALUE,
    buyerIdType: SUPPLIER_ID_TYPE,
    buyerName: "TEST BUYER"
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case "--type":
      case "-t":
        if (value && value in DOCUMENT_TYPES) {
          result.type = value as DocumentType;
        } else {
          console.error(`Invalid document type: ${value}`);
          console.error(`Valid types: ${Object.keys(DOCUMENT_TYPES).join(", ")}`);
          process.exit(1);
        }
        i++;
        break;
      case "--amount":
      case "-a":
        result.amount = parseFloat(value) || 1.00;
        i++;
        break;
      case "--version":
      case "-v":
        result.version = value === "1.0" ? "1.0" : "1.1";
        i++;
        break;
      case "--buyer-tin":
        result.buyerTin = value || result.buyerTin;
        i++;
        break;
      case "--buyer-id":
        result.buyerId = value || result.buyerId;
        i++;
        break;
      case "--buyer-id-type":
        result.buyerIdType = value || result.buyerIdType;
        i++;
        break;
      case "--buyer-name":
        result.buyerName = value || result.buyerName;
        i++;
        break;
      case "--ref-id":
        result.refId = value;
        i++;
        break;
      case "--ref-uuid":
        result.refUuid = value;
        i++;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  // Validate reference for credit/debit/refund notes
  if (REQUIRES_REFERENCE.includes(result.type)) {
    if (!result.refId || !result.refUuid) {
      console.error(`Document type "${result.type}" requires --ref-id and --ref-uuid`);
      console.error("These reference the original invoice that this document adjusts.");
      process.exit(1);
    }
  }

  // Consolidated invoice uses general public TIN with BRN=NA and Classification Code 004
  if (result.type === "consolidated") {
    result.buyerTin = "EI00000000010";
    result.buyerId = "NA";
    result.buyerIdType = "BRN";
    result.buyerName = "GENERAL PUBLIC";
  }

  return result;
}

function printHelp(): void {
  console.log(`
MyInvois Document Issuer

Usage:
  pnpm tsx scripts/issue-document.ts [options]

Document Types:
  invoice (01)              Standard invoice
  consolidated (01)         Consolidated invoice (buyer TIN: EI00000000010)
  credit-note (02)          Credit note (requires --ref-id and --ref-uuid)
  debit-note (03)           Debit note (requires --ref-id and --ref-uuid)
  refund-note (04)          Refund note (requires --ref-id and --ref-uuid)
  self-billed-invoice (11)  Self-billed invoice
  self-billed-credit (12)   Self-billed credit note (requires --ref-id and --ref-uuid)
  self-billed-debit (13)    Self-billed debit note (requires --ref-id and --ref-uuid)
  self-billed-refund (14)   Self-billed refund note (requires --ref-id and --ref-uuid)

Options:
  --type, -t         Document type (default: invoice)
  --amount, -a       Amount in MYR (default: 1.00)
  --version, -v      Document version: 1.0 or 1.1 (default: 1.1)
  --buyer-tin        Buyer TIN (default: EI00000000010)
  --buyer-id         Buyer ID value (default: 000000000000)
  --buyer-id-type    Buyer ID type: NRIC, PASSPORT, BRN, ARMY (default: NRIC)
  --buyer-name       Buyer name (default: GENERAL PUBLIC)
  --ref-id           Reference invoice ID (for credit/debit/refund notes)
  --ref-uuid         Reference invoice UUID (for credit/debit/refund notes)
  --help, -h         Show this help

Examples:
  # Issue a simple invoice
  pnpm tsx scripts/issue-document.ts --type invoice --amount 100

  # Issue a credit note referencing an invoice
  pnpm tsx scripts/issue-document.ts --type credit-note --amount 50 --ref-id INV-123 --ref-uuid abc-def-ghi

  # Issue a self-billed invoice
  pnpm tsx scripts/issue-document.ts --type self-billed-invoice --amount 200

  # Issue a v1.0 document (no digital signature)
  pnpm tsx scripts/issue-document.ts --type invoice --version 1.0 --amount 100
`);
}

function createDocument(args: Args): Record<string, unknown> {
  const docCode = `${DOCUMENT_PREFIXES[args.type]}-${Date.now()}`;
  const typeCode = DOCUMENT_TYPES[args.type];
  const today = new Date().toISOString().split("T")[0];
  const timeNow = new Date().toISOString().split("T")[1].substring(0, 8) + "Z";

  // Build buyer identification per LHDN sample structure
  const buyerIdentification = [
    { "ID": [{ "_": args.buyerTin, "schemeID": "TIN" }] },
    { "ID": [{ "_": args.buyerId, "schemeID": args.buyerIdType }] }
  ];

  // Classification code: 004 for consolidated (required with General TIN), 001 for others
  const classificationCode = args.type === "consolidated" ? "004" : "001";

  // Base document structure
  const document: Record<string, unknown> = {
    "_D": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "_A": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "_B": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    "Invoice": [{
      "ID": [{ "_": docCode }],
      "IssueDate": [{ "_": today }],
      "IssueTime": [{ "_": timeNow }],
      "InvoiceTypeCode": [{ "_": typeCode, "listVersionID": args.version }],
      "DocumentCurrencyCode": [{ "_": "MYR" }],
      ...(REQUIRES_REFERENCE.includes(args.type) ? {
        "BillingReference": [{
          "InvoiceDocumentReference": [{
            "ID": [{ "_": args.refId }],
            "UUID": [{ "_": args.refUuid }]
          }]
        }]
      } : {}),
      "AccountingSupplierParty": [{
        "Party": [{
          "IndustryClassificationCode": [{ "_": "62010", "name": "Computer programming activities" }],
          "PartyIdentification": [
            { "ID": [{ "_": SUPPLIER_TIN, "schemeID": "TIN" }] },
            { "ID": [{ "_": SUPPLIER_ID_VALUE, "schemeID": SUPPLIER_ID_TYPE }] }
          ],
          "PartyLegalEntity": [{ "RegistrationName": [{ "_": "SUPPLIER COMPANY" }] }],
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
          "PartyIdentification": buyerIdentification,
          "PartyLegalEntity": [{ "RegistrationName": [{ "_": args.buyerName }] }],
          "PostalAddress": [{
            "AddressLine": [{ "Line": [{ "_": "Customer Address" }] }],
            "CityName": [{ "_": "Kuala Lumpur" }],
            "PostalZone": [{ "_": "50000" }],
            "CountrySubentityCode": [{ "_": "14" }],
            "Country": [{
              "IdentificationCode": [{ "_": "MYS", "listID": "ISO3166-1", "listAgencyID": "6" }]
            }]
          }],
          "Contact": [{ "Telephone": [{ "_": "+60300000001" }] }]
        }]
      }],
      "LegalMonetaryTotal": [{
        "LineExtensionAmount": [{ "_": args.amount, "currencyID": "MYR" }],
        "TaxExclusiveAmount": [{ "_": args.amount, "currencyID": "MYR" }],
        "TaxInclusiveAmount": [{ "_": args.amount, "currencyID": "MYR" }],
        "PayableAmount": [{ "_": args.amount, "currencyID": "MYR" }]
      }],
      "TaxTotal": [{
        "TaxAmount": [{ "_": 0.00, "currencyID": "MYR" }],
        "TaxSubtotal": [{
          "TaxableAmount": [{ "_": args.amount, "currencyID": "MYR" }],
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
        "LineExtensionAmount": [{ "_": args.amount, "currencyID": "MYR" }],
        "TaxTotal": [{
          "TaxAmount": [{ "_": 0.00, "currencyID": "MYR" }],
          "TaxSubtotal": [{
            "TaxableAmount": [{ "_": args.amount, "currencyID": "MYR" }],
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
          "Description": [{ "_": `Service Item RM${args.amount.toFixed(2)}` }],
          "CommodityClassification": [{
            "ItemClassificationCode": [{ "_": classificationCode, "listID": "CLASS" }]
          }]
        }],
        "Price": [{ "PriceAmount": [{ "_": args.amount, "currencyID": "MYR" }] }],
        "ItemPriceExtension": [{ "Amount": [{ "_": args.amount, "currencyID": "MYR" }] }]
      }]
    }]
  };

  return document;
}

async function sleep(ms: number): Promise<void> {
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

  const data = await resp.json() as { access_token?: string };
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

    const data = await resp.json() as { overallStatus?: string };
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

async function main(): Promise<void> {
  const args = parseArgs();

  console.log("=".repeat(60));
  console.log(`  MyInvois Document Submission (${MYINVOIS_ENV})`);
  console.log("=".repeat(60));
  console.log(`  Document Type: ${args.type} (code: ${DOCUMENT_TYPES[args.type]})`);
  console.log(`  Version: ${args.version}`);
  console.log(`  Amount: RM ${args.amount.toFixed(2)}`);
  console.log(`  Buyer: ${args.buyerName} (${args.buyerTin})`);
  if (args.refId) {
    console.log(`  Reference: ${args.refId} (${args.refUuid})`);
  }
  console.log(`  Environment: ${MYINVOIS_ENV}`);
  console.log(`  API: ${BASE_URL}`);
  console.log("");

  // Validate environment
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("ERROR: Missing MYINVOIS_CLIENT_ID or MYINVOIS_CLIENT_SECRET_1");
    process.exit(1);
  }

  // Create document
  const document = createDocument(args);
  const docCode = ((document["Invoice"] as Array<{ ID: Array<{ _: string }> }>)[0]).ID[0]._;
  console.log(`Document: ${docCode}`);

  let finalDocument: Record<string, unknown>;
  let signedDocJson: string;

  // For v1.1, sign the document
  if (args.version === "1.1") {
    const p12Path = process.env.SIGNING_PKCS12_PATH!;
    const p12Pass = process.env.SIGNING_PKCS12_PASSPHRASE!;

    if (!p12Path) {
      console.error("ERROR: Missing SIGNING_PKCS12_PATH for v1.1 documents");
      process.exit(1);
    }

    console.log("Loading certificate...");
    const p12 = loadPKCS12({ path: p12Path, passphrase: p12Pass });
    console.log("  Certificate:", p12.certInfo.subject.CN || p12.certInfo.subject.raw);

    console.log("Signing document...");
    const signer = new SigningService(p12.privateKey, p12.certPem, p12.certInfo);
    const result = signer.sign(document);
    finalDocument = result.signedDocument;
    signedDocJson = JSON.stringify(finalDocument);
    console.log("  Document hash:", result.documentHash.substring(0, 32) + "...");
  } else {
    // v1.0 - no signing required
    finalDocument = document;
    signedDocJson = JSON.stringify(finalDocument);
    console.log("  Version 1.0 - No signature required");
  }

  const docBase64 = Buffer.from(signedDocJson, "utf-8").toString("base64");
  const docHash = createHash("sha256").update(signedDocJson, "utf-8").digest("hex");

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
        document: docBase64,
        documentHash: docHash,
        codeNumber: docCode
      }]
    })
  });

  const submitData = await submitResp.json() as {
    submissionUid?: string;
    acceptedDocuments?: Array<{ uuid: string }>;
  };

  if (submitResp.status !== 202) {
    console.error("Submission failed:", submitResp.status);
    console.error(JSON.stringify(submitData, null, 2));
    process.exit(1);
  }

  const submissionUid = submitData.submissionUid!;
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
    const details = await detailsResp.json() as { longId?: string; status?: string };

    console.log("\n" + "=".repeat(60));
    console.log("  DOCUMENT ISSUED SUCCESSFULLY");
    console.log("=".repeat(60));
    console.log(`  Document Type: ${args.type.toUpperCase()}`);
    console.log(`  Document Code: ${docCode}`);
    console.log(`  Amount: RM ${args.amount.toFixed(2)}`);
    console.log(`  UUID: ${docUuid}`);
    console.log(`  Long ID: ${details.longId || "(pending)"}`);
    console.log(`  Status: ${details.status}`);
    console.log("=".repeat(60));
  } else {
    console.log("\n" + "=".repeat(60));
    console.log(`  Final Status: ${finalStatus}`);
    console.log("=".repeat(60));
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
