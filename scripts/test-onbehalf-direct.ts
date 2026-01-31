/**
 * Direct test for ERP On-Behalf submission to MyInvois API
 * This bypasses the gateway to see actual MyInvois error responses
 */

import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { SigningService, loadPKCS12 } from "../packages/signing/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env") });

// B POINT STATION details (from client's MyInvois portal)
const BPOINT_TIN = "C24558460090";
const _BPOINT_BRN = "200501027210"; // Reserved for future use
const BPOINT_NAME = "B POINT STATION SDN. BHD";
const BPOINT_ADDRESS = "NO.14,JALAN YAHYA AL-DATAR, MUKIM BANDAR,";
const BPOINT_CITY = "JOHOR BAHRU";
const BPOINT_POSTAL = "80000";
const BPOINT_STATE = "01"; // Johor
const BPOINT_PHONE = "+60177275212";
const BPOINT_EMAIL = "BPOINTSTATIONSB@GMAIL.COM";
const BPOINT_MSIC = "56101"; // Restaurants

// Environment - production API
const BASE_URL =
  process.env.ERP_MYINVOIS_ENV === "PROD"
    ? "https://api.myinvois.hasil.gov.my"
    : "https://preprod-api.myinvois.hasil.gov.my";

console.log("=".repeat(60));
console.log("Direct On-Behalf Test to MyInvois API");
console.log("=".repeat(60));
console.log(`Environment: ${process.env.ERP_MYINVOIS_ENV || "SANDBOX"}`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`On-behalf TIN: ${BPOINT_TIN}`);
console.log(`ERP Client ID: ${process.env.ERP_MYINVOIS_CLIENT_ID?.substring(0, 8)}...`);

async function getToken(): Promise<string> {
  const url = `${BASE_URL}/connect/token`;

  const clientId = process.env.ERP_MYINVOIS_CLIENT_ID!;
  const clientSecret = process.env.ERP_MYINVOIS_CLIENT_SECRET!;

  console.log("\n=== Getting Token (INTERMEDIARY mode with onbehalfof) ===");
  console.log(`URL: ${url}`);
  console.log(`onbehalfof header: ${BPOINT_TIN}`);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "InvoicingAPI",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      onbehalfof: BPOINT_TIN, // INTERMEDIARY mode
    },
    body,
  });

  console.log(`Response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Token error:", errorText);
    throw new Error(`Token request failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  console.log(`✓ Token obtained, expires in: ${data.expires_in}s`);
  return data.access_token;
}

function buildConsolidatedInvoice(): Record<string, unknown> {
  const invoiceNumber = `CONS-DIRECT-${Date.now()}`;
  // Use UTC time minus 5 minutes to avoid future time validation
  const now = new Date(Date.now() - 5 * 60 * 1000);
  const issueDate = now.toISOString().split("T")[0];
  const issueTime = now.toISOString().split("T")[1].split(".")[0] + "Z";

  // Build minimal UBL 2.1 invoice for B POINT STATION
  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [
      {
        ID: [{ _: invoiceNumber }],
        IssueDate: [{ _: issueDate }],
        IssueTime: [{ _: issueTime }],
        InvoiceTypeCode: [{ _: "01", listVersionID: "1.1" }], // 01 = Invoice
        DocumentCurrencyCode: [{ _: "MYR" }],
        InvoicePeriod: [
          {
            StartDate: [{ _: issueDate }],
            EndDate: [{ _: issueDate }],
            Description: [{ _: "Daily" }],
          },
        ],
        BillingReference: [
          {
            AdditionalDocumentReference: [
              {
                ID: [{ _: "NA" }],
              },
            ],
          },
        ],
        AccountingSupplierParty: [
          {
            Party: [
              {
                IndustryClassificationCode: [{ _: BPOINT_MSIC, name: "Restaurants" }],
                PartyIdentification: [
                  { ID: [{ _: BPOINT_TIN, schemeID: "TIN" }] },
                  { ID: [{ _: "NA", schemeID: "BRN" }] }, // No BRN
                ],
                PostalAddress: [
                  {
                    CityName: [{ _: BPOINT_CITY }],
                    PostalZone: [{ _: BPOINT_POSTAL }],
                    CountrySubentityCode: [{ _: BPOINT_STATE }],
                    AddressLine: [{ Line: [{ _: BPOINT_ADDRESS }] }],
                    Country: [
                      {
                        IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }],
                      },
                    ],
                  },
                ],
                PartyLegalEntity: [
                  {
                    RegistrationName: [{ _: BPOINT_NAME }],
                  },
                ],
                Contact: [
                  {
                    Telephone: [{ _: BPOINT_PHONE }],
                    ElectronicMail: [{ _: BPOINT_EMAIL }],
                  },
                ],
              },
            ],
          },
        ],
        AccountingCustomerParty: [
          {
            Party: [
              {
                PartyIdentification: [
                  { ID: [{ _: "C23880177020", schemeID: "TIN" }] }, // JB Multimedia TIN
                  { ID: [{ _: "201501009208", schemeID: "BRN" }] }, // JB Multimedia BRN
                ],
                PostalAddress: [
                  {
                    CityName: [{ _: "JOHOR BAHRU" }],
                    PostalZone: [{ _: "81200" }],
                    CountrySubentityCode: [{ _: "01" }],
                    AddressLine: [
                      { Line: [{ _: "NO 28, JALAN MUTIARA EMAS 10/1, TAMAN MOUNT AUSTIN" }] },
                    ],
                    Country: [
                      {
                        IdentificationCode: [{ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" }],
                      },
                    ],
                  },
                ],
                PartyLegalEntity: [
                  {
                    RegistrationName: [{ _: "JB MULTIMEDIA SERVICES SDN. BHD." }],
                  },
                ],
                Contact: [
                  {
                    Telephone: [{ _: "0177877078" }],
                    ElectronicMail: [{ _: "admin@jbmultimedia.com" }],
                  },
                ],
              },
            ],
          },
        ],
        TaxTotal: [
          {
            TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
            TaxSubtotal: [
              {
                TaxableAmount: [{ _: 100.0, currencyID: "MYR" }],
                TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                TaxCategory: [
                  {
                    ID: [{ _: "E" }],
                    TaxExemptionReason: [{ _: "Tax exemption" }],
                    TaxScheme: [
                      {
                        ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: 100.0, currencyID: "MYR" }],
            TaxExclusiveAmount: [{ _: 100.0, currencyID: "MYR" }],
            TaxInclusiveAmount: [{ _: 100.0, currencyID: "MYR" }],
            AllowanceTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            ChargeTotalAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableRoundingAmount: [{ _: 0.0, currencyID: "MYR" }],
            PayableAmount: [{ _: 100.0, currencyID: "MYR" }],
          },
        ],
        InvoiceLine: [
          {
            ID: [{ _: "1" }],
            InvoicedQuantity: [{ _: 1, unitCode: "C62" }],
            LineExtensionAmount: [{ _: 100.0, currencyID: "MYR" }],
            AllowanceCharge: [
              {
                ChargeIndicator: [{ _: false }],
                AllowanceChargeReason: [{ _: "Discount" }],
                Amount: [{ _: 0.0, currencyID: "MYR" }],
              },
            ],
            TaxTotal: [
              {
                TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                TaxSubtotal: [
                  {
                    TaxableAmount: [{ _: 100.0, currencyID: "MYR" }],
                    TaxAmount: [{ _: 0.0, currencyID: "MYR" }],
                    TaxCategory: [
                      {
                        ID: [{ _: "E" }],
                        TaxExemptionReason: [{ _: "Tax exemption" }],
                        TaxScheme: [
                          {
                            ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            Item: [
              {
                Description: [{ _: "Daily consolidated sales - Direct on-behalf test" }],
                CommodityClassification: [
                  {
                    ItemClassificationCode: [{ _: "001", listID: "CLASS" }],
                  },
                ],
              },
            ],
            Price: [
              {
                PriceAmount: [{ _: 100.0, currencyID: "MYR" }],
              },
            ],
            ItemPriceExtension: [
              {
                Amount: [{ _: 100.0, currencyID: "MYR" }],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function submitDocument(token: string, signedDoc: Record<string, unknown>): Promise<void> {
  const url = `${BASE_URL}/api/v1.0/documentsubmissions/`;

  const documentJson = JSON.stringify(signedDoc);
  const documentBase64 = Buffer.from(documentJson, "utf-8").toString("base64");
  // IMPORTANT: Hash must be HEX encoded (not base64!)
  const documentHash = createHash("sha256").update(documentJson, "utf-8").digest("hex");

  const invoice = (signedDoc as any).Invoice?.[0];
  const codeNumber = invoice?.ID?.[0]?._ || "UNKNOWN";

  console.log("\n=== Submitting Document (with onbehalfof header) ===");
  console.log(`URL: ${url}`);
  console.log(`Document hash: ${documentHash}`);
  console.log(`Code number: ${codeNumber}`);
  console.log(`Document size: ${documentJson.length} bytes`);
  console.log(`onbehalfof header: ${BPOINT_TIN}`);

  const requestBody = {
    documents: [
      {
        format: "JSON",
        document: documentBase64,
        documentHash: documentHash,
        codeNumber: codeNumber,
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      onbehalfof: BPOINT_TIN, // INTERMEDIARY mode
    },
    body: JSON.stringify(requestBody),
  });

  console.log(`\nResponse status: ${response.status}`);
  console.log("Response headers:");
  response.headers.forEach((value, key) => {
    console.log(`  ${key}: ${value}`);
  });

  const responseBody = await response.text();
  console.log("\nResponse body:");
  try {
    const parsed = JSON.parse(responseBody);
    console.log(JSON.stringify(parsed, null, 2));

    // Extract key info
    if (parsed.acceptedDocuments?.length > 0) {
      console.log("\n✓ DOCUMENT ACCEPTED!");
      for (const doc of parsed.acceptedDocuments) {
        console.log(`  UUID: ${doc.uuid}`);
        console.log(`  Invoice: ${doc.invoiceCodeNumber}`);
      }
    }

    if (parsed.rejectedDocuments?.length > 0) {
      console.log("\n✗ DOCUMENT REJECTED!");
      for (const doc of parsed.rejectedDocuments) {
        console.log(`  Invoice: ${doc.invoiceCodeNumber}`);
        console.log(`  Error: ${doc.error?.error || JSON.stringify(doc.error)}`);
      }
    }
  } catch {
    console.log(responseBody);
  }
}

async function main() {
  try {
    // Get token
    const token = await getToken();

    // Build invoice
    console.log("\n=== Building Invoice ===");
    const invoice = buildConsolidatedInvoice();
    const invoiceNumber = (invoice.Invoice as any[])[0].ID[0]._;
    console.log(`Invoice number: ${invoiceNumber}`);
    console.log(`Supplier: ${BPOINT_NAME} (${BPOINT_TIN})`);

    // Load certificate and sign
    console.log("\n=== Signing Document ===");
    const p12Path = process.env.SIGNING_PKCS12_PATH!;
    const p12Passphrase = process.env.SIGNING_PKCS12_PASSPHRASE!;

    const p12Result = loadPKCS12({
      path: p12Path,
      passphrase: p12Passphrase,
    });
    console.log(`Certificate: ${p12Result.certInfo.subject.CN}`);

    const signingService = new SigningService(
      p12Result.privateKey,
      p12Result.certPem,
      p12Result.certInfo
    );

    const result = signingService.sign(invoice);
    console.log(`Document hash: ${result.documentHash}`);

    // Submit
    await submitDocument(token, result.signedDocument);
  } catch (error) {
    console.error("\nFatal error:", error);
    process.exit(1);
  }
}

main();
