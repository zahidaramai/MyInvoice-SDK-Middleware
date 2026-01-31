import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import { SigningService, loadPKCS12 } from "../packages/signing/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env") });

const invoice = {
  _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  Invoice: [
    {
      ID: [{ _: "TEST-INV" }],
      IssueDate: [{ _: "2026-01-13" }],
      InvoiceTypeCode: [{ _: "01", listVersionID: "1.1" }],
      DocumentCurrencyCode: [{ _: "MYR" }],
      LegalMonetaryTotal: [{ PayableAmount: [{ _: 1.0, currencyID: "MYR" }] }],
    },
  ],
};

const p12 = loadPKCS12({
  path: process.env.SIGNING_PKCS12_PATH!,
  passphrase: process.env.SIGNING_PKCS12_PASSPHRASE!,
});

const signer = new SigningService(p12.privateKey, p12.certPem, p12.certInfo);
const result = signer.sign(invoice);

console.log("=== SIGNED DOCUMENT STRUCTURE ===\n");

// Show full structure
const signedDoc = result.signedDocument as Record<string, unknown>;
const invoiceContent = (signedDoc.Invoice as any[])[0];

console.log("Invoice element keys (in order):");
Object.keys(invoiceContent).forEach((key, idx) => {
  console.log(`  ${idx + 1}. ${key}`);
});

console.log("\n=== UBLExtensions Structure ===");
const ublExt = invoiceContent.UBLExtensions;
console.log(JSON.stringify(ublExt, null, 2).substring(0, 2000) + "...");

console.log("\n=== Signature Structure ===");
const sig = invoiceContent.Signature;
console.log(JSON.stringify(sig, null, 2));

// Write full document to file for inspection
fs.writeFileSync(
  resolve(__dirname, "debug-signed-full.json"),
  JSON.stringify(result.signedDocument, null, 2)
);
console.log("\nFull signed document written to scripts/debug-signed-full.json");
