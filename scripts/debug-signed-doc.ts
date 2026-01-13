/**
 * Debug script to output the signed document structure
 */

import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync } from "fs";
import {
  SigningService,
  loadPKCS12,
} from "../packages/signing/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env") });

async function main() {
  try {
    // Load test invoice
    const invoicePath = resolve(__dirname, "test-invoice.json");
    const invoiceContent = readFileSync(invoicePath, "utf-8");
    const invoice = JSON.parse(invoiceContent);

    console.log("=== Original Invoice Structure ===");
    console.log("Top-level keys:", Object.keys(invoice));

    // Load PKCS#12
    const p12Path = process.env.SIGNING_PKCS12_PATH!;
    const p12Passphrase = process.env.SIGNING_PKCS12_PASSPHRASE!;

    const p12Result = loadPKCS12({
      path: p12Path,
      passphrase: p12Passphrase,
    });

    console.log("\nCertificate Info:");
    console.log("  Subject:", JSON.stringify(p12Result.certInfo.subject));
    console.log("  Issuer:", JSON.stringify(p12Result.certInfo.issuer));

    // Create signing service
    const signingService = new SigningService(
      p12Result.privateKey,
      p12Result.certPem,
      p12Result.certInfo
    );

    // Sign the document
    const result = signingService.sign(invoice);
    const signedDocument = result.signedDocument as Record<string, unknown>;

    console.log("\n=== Signed Document Structure ===");
    console.log("Top-level keys:", Object.keys(signedDocument));

    // Output the signed document to a file for inspection
    const outputPath = resolve(__dirname, "signed-invoice.json");
    writeFileSync(outputPath, JSON.stringify(signedDocument, null, 2));
    console.log("\nSigned document saved to:", outputPath);

    // Check the Invoice structure
    if (signedDocument.Invoice) {
      const invoiceObj = signedDocument.Invoice as Record<string, unknown>;
      console.log("\nInvoice object type:", typeof invoiceObj);
      console.log("Invoice object keys:", Object.keys(invoiceObj));

      // Check if it's an array (MyInvois format) or object
      if (Array.isArray(invoiceObj)) {
        console.log("Invoice is an ARRAY");
        const firstItem = invoiceObj[0] as Record<string, unknown>;
        console.log("First item keys:", Object.keys(firstItem));
      } else {
        console.log("Invoice is an OBJECT");

        // Check UBLExtensions
        if (invoiceObj.UBLExtensions) {
          console.log("\nUBLExtensions present");
          console.log("UBLExtensions structure:", JSON.stringify(invoiceObj.UBLExtensions, null, 2).slice(0, 500) + "...");
        }
      }
    }

    // Also check what MyInvois expects
    console.log("\n=== MyInvois Expected Structure ===");
    console.log("MyInvois v1.1 expects the UBLExtensions to be placed as the FIRST element");
    console.log("inside the Invoice array, with a specific structure.");

  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

main();
