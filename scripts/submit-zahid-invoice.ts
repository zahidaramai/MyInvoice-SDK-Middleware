import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import {
  SigningService,
  loadPKCS12,
} from "../packages/signing/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env") });

const PROD_BASE_URL = "https://api.myinvois.hasil.gov.my";

const invNum = "INV-" + Date.now();
const today = new Date().toISOString().split("T")[0];
const timeNow = new Date().toISOString().split("T")[1].substring(0,8) + "Z";

const invoice = {
  "_D": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  "_A": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  "_B": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  "Invoice": [{
    "ID": [{"_": invNum}],
    "IssueDate": [{"_": today}],
    "IssueTime": [{"_": timeNow}],
    "InvoiceTypeCode": [{"_": "01", "listVersionID": "1.1"}],
    "DocumentCurrencyCode": [{"_": "MYR"}],
    "AccountingSupplierParty": [{
      "Party": [{
        "IndustryClassificationCode": [{"_": "62010", "name": "Computer programming activities"}],
        "PartyIdentification": [{
          "ID": [{"_": "C23880177020", "schemeID": "TIN"}]
        }, {
          "ID": [{"_": "201501009208", "schemeID": "BRN"}]
        }],
        "PartyLegalEntity": [{
          "RegistrationName": [{"_": "JB MULTIMEDIA SERVICES SDN. BHD."}]
        }],
        "PostalAddress": [{
          "AddressLine": [{"Line": [{"_": "No 1, Jalan Test"}]}],
          "CityName": [{"_": "Johor Bahru"}],
          "PostalZone": [{"_": "81100"}],
          "CountrySubentityCode": [{"_": "01"}],
          "Country": [{
            "IdentificationCode": [{"_": "MYS", "listID": "ISO3166-1", "listAgencyID": "6"}]
          }]
        }],
        "Contact": [{
          "Telephone": [{"_": "+60123456789"}],
          "ElectronicMail": [{"_": "test@jbmultimedia.com"}]
        }]
      }]
    }],
    "AccountingCustomerParty": [{
      "Party": [{
        "PartyIdentification": [{
          "ID": [{"_": "EI00000000010", "schemeID": "TIN"}]
        }, {
          "ID": [{"_": "901120125931", "schemeID": "NRIC"}]
        }],
        "PartyLegalEntity": [{
          "RegistrationName": [{"_": "Muhammad Zahid Bin Zamanshah"}]
        }],
        "PostalAddress": [{
          "AddressLine": [{"Line": [{"_": "Test Address"}]}],
          "CityName": [{"_": "Kuala Lumpur"}],
          "PostalZone": [{"_": "50000"}],
          "CountrySubentityCode": [{"_": "14"}],
          "Country": [{
            "IdentificationCode": [{"_": "MYS", "listID": "ISO3166-1", "listAgencyID": "6"}]
          }]
        }],
        "Contact": [{
          "Telephone": [{"_": "+60123456789"}]
        }]
      }]
    }],
    "LegalMonetaryTotal": [{
      "LineExtensionAmount": [{"_": 1.00, "currencyID": "MYR"}],
      "TaxExclusiveAmount": [{"_": 1.00, "currencyID": "MYR"}],
      "TaxInclusiveAmount": [{"_": 1.00, "currencyID": "MYR"}],
      "PayableAmount": [{"_": 1.00, "currencyID": "MYR"}]
    }],
    "TaxTotal": [{
      "TaxAmount": [{"_": 0.00, "currencyID": "MYR"}],
      "TaxSubtotal": [{
        "TaxableAmount": [{"_": 1.00, "currencyID": "MYR"}],
        "TaxAmount": [{"_": 0.00, "currencyID": "MYR"}],
        "TaxCategory": [{
          "ID": [{"_": "E"}],
          "TaxExemptionReason": [{"_": "Exempt New Means of Transport"}],
          "TaxScheme": [{
            "ID": [{"_": "OTH", "schemeID": "UN/ECE 5153", "schemeAgencyID": "6"}]
          }]
        }]
      }]
    }],
    "InvoiceLine": [{
      "ID": [{"_": "1"}],
      "InvoicedQuantity": [{"_": 1, "unitCode": "C62"}],
      "LineExtensionAmount": [{"_": 1.00, "currencyID": "MYR"}],
      "TaxTotal": [{
        "TaxAmount": [{"_": 0.00, "currencyID": "MYR"}],
        "TaxSubtotal": [{
          "TaxableAmount": [{"_": 1.00, "currencyID": "MYR"}],
          "TaxAmount": [{"_": 0.00, "currencyID": "MYR"}],
          "TaxCategory": [{
            "ID": [{"_": "E"}],
            "TaxExemptionReason": [{"_": "Exempt New Means of Transport"}],
            "TaxScheme": [{
              "ID": [{"_": "OTH", "schemeID": "UN/ECE 5153", "schemeAgencyID": "6"}]
            }]
          }]
        }]
      }],
      "Item": [{
        "Description": [{"_": "Test Item RM1.00"}],
        "CommodityClassification": [{
          "ItemClassificationCode": [{"_": "001", "listID": "CLASS"}]
        }]
      }],
      "Price": [{
        "PriceAmount": [{"_": 1.00, "currencyID": "MYR"}]
      }],
      "ItemPriceExtension": [{
        "Amount": [{"_": 1.00, "currencyID": "MYR"}]
      }]
    }]
  }]
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollSubmission(token: string, submissionUid: string): Promise<string> {
  console.log("\n=== POLLING FOR VALIDATION ===");

  for (let i = 0; i < 60; i++) {  // Poll for up to 3 minutes
    await sleep(3000);

    const resp = await fetch(`${PROD_BASE_URL}/api/v1.0/documentsubmissions/${submissionUid}`, {
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/json"
      }
    });

    const data = await resp.json() as any;
    const status = data.overallStatus;

    console.log(`  Poll ${i + 1}: ${status}`);

    if (status === "Valid" || status === "valid") {
      console.log("\n=== SUBMISSION VALID ===");
      console.log(JSON.stringify(data, null, 2));
      return "Valid";
    }

    if (status === "Invalid" || status === "invalid") {
      console.log("\n=== SUBMISSION INVALID ===");
      console.log(JSON.stringify(data, null, 2));
      return "Invalid";
    }

    if (status === "Partially Valid" || status === "partially valid") {
      console.log("\n=== SUBMISSION PARTIALLY VALID ===");
      console.log(JSON.stringify(data, null, 2));
      return "Partially Valid";
    }
  }

  return "Timeout";
}

async function main() {
  const p12Path = process.env.SIGNING_PKCS12_PATH!;
  const p12Pass = process.env.SIGNING_PKCS12_PASSPHRASE!;

  console.log("Loading certificate...");
  const p12 = loadPKCS12({ path: p12Path, passphrase: p12Pass });
  console.log("Certificate loaded");

  console.log("\nSigning invoice:", invNum);
  console.log("Customer: Muhammad Zahid Bin Zamanshah");
  console.log("NRIC: 901120125931");
  console.log("Amount: RM 1.00");

  const signer = new SigningService(p12.privateKey, p12.certPem, p12.certInfo);
  const result = signer.sign(invoice);

  const signedDocJson = JSON.stringify(result.signedDocument);
  const signedDocBase64 = Buffer.from(signedDocJson, "utf-8").toString("base64");
  const docHash = createHash("sha256").update(signedDocJson, "utf-8").digest("hex");

  console.log("\nSigned!");
  console.log("  Document hash (hex):", docHash);

  console.log("\nGetting PROD token...");
  const tokenResp = await fetch(PROD_BASE_URL + "/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "b61db8d5-f324-4ca8-8c35-5bd366cac95b",
      client_secret: "93f4f48d-53bc-4b52-b588-3f4e02f22df9",
      scope: "InvoicingAPI"
    })
  });

  const tokenData = await tokenResp.json() as any;
  if (!tokenData.access_token) {
    console.error("Token error:", tokenData);
    return;
  }
  console.log("Token OK");

  console.log("\n=== SUBMITTING TO PROD ===");

  const submitResp = await fetch(PROD_BASE_URL + "/api/v1.0/documentsubmissions/", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + tokenData.access_token,
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

  console.log("Status:", submitResp.status);

  const body = await submitResp.text();
  let submissionData: any;
  try {
    submissionData = JSON.parse(body);
    console.log("\nSubmission Response:");
    console.log(JSON.stringify(submissionData, null, 2));
  } catch {
    console.log(body);
    return;
  }

  if (submitResp.status !== 202 || !submissionData.submissionUid) {
    console.error("Submission failed!");
    return;
  }

  const submissionUid = submissionData.submissionUid;
  console.log("\nSubmission UID:", submissionUid);

  // Poll for VALID status
  const finalStatus = await pollSubmission(tokenData.access_token, submissionUid);

  // Get document validation details
  console.log("\n=== DOCUMENT VALIDATION DETAILS ===");
  const docUuid = submissionData.acceptedDocuments[0]?.uuid;
  if (docUuid) {
    const detailsResp = await fetch(`${PROD_BASE_URL}/api/v1.0/documents/${docUuid}/details`, {
      headers: {
        "Authorization": "Bearer " + tokenData.access_token,
        "Accept": "application/json"
      }
    });
    const details = await detailsResp.json() as any;
    console.log("Status:", details.status);
    console.log("LongId:", details.longId || "(pending)");
    console.log("Validation Status:", details.validationResults?.status);
    if (details.validationResults?.validationSteps) {
      console.log("\nValidation Steps:");
      for (const step of details.validationResults.validationSteps) {
        console.log(`  ${step.name}: ${step.status}`);
        if (step.error) {
          console.log(`    Error: ${step.error.errorCode} - ${step.error.error}`);
        }
      }
    }
  }

  console.log("\n=== FINAL RESULT ===");
  console.log("Invoice:", invNum);
  console.log("Submission UID:", submissionUid);
  console.log("Document UUID:", docUuid);
  console.log("Final Status:", finalStatus);
}

main().catch(console.error);
