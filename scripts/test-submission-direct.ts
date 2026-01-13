/**
 * Direct test script to submit a v1.1 signed document to MyInvois API
 * and see the full error response
 */

import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import {
  SigningService,
  loadPKCS12,
} from "../packages/signing/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env") });

const SANDBOX_BASE_URL = "https://preprod-api.myinvois.hasil.gov.my";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function getToken(): Promise<string> {
  const url = `${SANDBOX_BASE_URL}/connect/token`;

  const clientId = process.env.MYINVOIS_CLIENT_ID!;
  const clientSecret = process.env.MYINVOIS_CLIENT_SECRET_1!;
  const supplierTin = process.env.MYINVOIS_SUPPLIER_TIN!;

  console.log("Getting token for intermediary mode...");
  console.log("  Client ID:", clientId);
  console.log("  Supplier TIN (onbehalfof):", supplierTin);

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
      "onbehalfof": supplierTin,  // Intermediary mode
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Token error:", response.status, errorText);
    throw new Error(`Token request failed: ${response.status}`);
  }

  const data = await response.json() as TokenResponse;
  console.log("Token obtained successfully, expires in:", data.expires_in, "seconds");
  return data.access_token;
}

async function submitDocument(token: string, signedDocument: Record<string, unknown>): Promise<void> {
  const url = `${SANDBOX_BASE_URL}/api/v1.0/documentsubmissions/`;
  const supplierTin = process.env.MYINVOIS_SUPPLIER_TIN!;

  // Encode document to base64
  const documentJson = JSON.stringify(signedDocument);
  const documentBase64 = Buffer.from(documentJson, "utf-8").toString("base64");
  const documentHash = createHash("sha256").update(documentJson, "utf-8").digest("base64");

  // Extract codeNumber from invoice
  const invoice = (signedDocument as any).Invoice?.[0];
  const codeNumber = invoice?.ID?.[0]?._  || "UNKNOWN";

  console.log("\nSubmitting document...");
  console.log("  Document hash:", documentHash);
  console.log("  Code number:", codeNumber);
  console.log("  Document size:", documentJson.length, "bytes");

  const requestBody = {
    documents: [{
      format: "JSON",
      document: documentBase64,
      documentHash: documentHash,
      codeNumber: codeNumber,
    }],
  };

  console.log("\nRequest details:");
  console.log("  URL:", url);
  console.log("  Headers: Authorization: Bearer <token>, onbehalfof:", supplierTin);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "onbehalfof": supplierTin,  // Required for intermediary mode
    },
    body: JSON.stringify(requestBody),
  });

  console.log("\nResponse status:", response.status);
  console.log("Response headers:");
  response.headers.forEach((value, key) => {
    console.log(`  ${key}: ${value}`);
  });

  const responseBody = await response.text();
  console.log("\nResponse body:");
  try {
    const parsed = JSON.parse(responseBody);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(responseBody);
  }
}

async function main() {
  try {
    // Load test invoice
    const invoicePath = resolve(__dirname, "test-invoice.json");
    const invoiceContent = readFileSync(invoicePath, "utf-8");
    const invoice = JSON.parse(invoiceContent);

    console.log("Loaded test invoice:", invoicePath);

    // Load PKCS#12
    const p12Path = process.env.SIGNING_PKCS12_PATH!;
    const p12Passphrase = process.env.SIGNING_PKCS12_PASSPHRASE!;

    console.log("\nLoading certificate from:", p12Path);

    const p12Result = loadPKCS12({
      path: p12Path,
      passphrase: p12Passphrase,
    });

    console.log("Certificate loaded:", p12Result.certInfo.subject.CN);

    // Create signing service
    const signingService = new SigningService(
      p12Result.privateKey,
      p12Result.certPem,
      p12Result.certInfo
    );

    console.log("\nSigning document...");
    const result = signingService.sign(invoice);
    console.log("Document signed successfully");
    console.log("  Document hash:", result.documentHash);
    const signedDocument = result.signedDocument;

    // Check UBLExtensions
    const ublExt = (signedDocument as any).Invoice?.[0]?.UBLExtensions;
    if (ublExt) {
      console.log("\nUBLExtensions present:");
      const ext = ublExt[0]?.UBLExtension?.[0]?.ExtensionContent?.[0]?.UBLDocumentSignatures?.[0];
      if (ext) {
        console.log("  SignatureInformation present:", !!ext.SignatureInformation);
      }
    }

    // Get token and submit
    const token = await getToken();
    await submitDocument(token, signedDocument);

  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

main();
