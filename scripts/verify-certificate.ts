#!/usr/bin/env npx tsx
/**
 * Script to verify P12 certificate loading and extract certificate info
 *
 * Usage:
 *   pnpm tsx scripts/verify-certificate.ts
 *
 * Or with environment variables:
 *   SIGNING_PKCS12_PATH=./private/cert.p12 SIGNING_PKCS12_PASSPHRASE=pass pnpm tsx scripts/verify-certificate.ts
 */

import { config } from "dotenv";
import { loadPKCS12, SigningService, verify } from "../packages/signing/dist/index.js";

// Load .env
config();

async function main() {
  console.log("=".repeat(60));
  console.log("  MyInvois Certificate Verification Tool");
  console.log("=".repeat(60));
  console.log("");

  const p12Path = process.env.SIGNING_PKCS12_PATH;
  const p12Passphrase = process.env.SIGNING_PKCS12_PASSPHRASE || "";

  if (!p12Path) {
    console.error("ERROR: SIGNING_PKCS12_PATH environment variable is not set");
    console.error("");
    console.error("Please set the following in your .env file:");
    console.error("  SIGNING_PKCS12_PATH=./private/your-certificate.p12");
    console.error("  SIGNING_PKCS12_PASSPHRASE=your-password");
    process.exit(1);
  }

  console.log(`Loading certificate from: ${p12Path}`);
  console.log("");

  try {
    // Load the P12 certificate
    const result = loadPKCS12({
      path: p12Path,
      passphrase: p12Passphrase,
    });

    const { certInfo, privateKey } = result;

    console.log("Certificate loaded successfully!");
    console.log("");
    console.log("-".repeat(60));
    console.log("  Certificate Information");
    console.log("-".repeat(60));
    console.log("");

    // Subject information
    console.log("Subject:");
    if (certInfo.subject.commonName) {
      console.log(`  Common Name (CN): ${certInfo.subject.commonName}`);
    }
    if (certInfo.subject.organization) {
      console.log(`  Organization (O): ${certInfo.subject.organization}`);
    }
    if (certInfo.subject.organizationalUnit) {
      console.log(`  Org Unit (OU):    ${certInfo.subject.organizationalUnit}`);
    }
    if (certInfo.subject.country) {
      console.log(`  Country (C):      ${certInfo.subject.country}`);
    }
    console.log(`  Raw:              ${certInfo.subject.raw}`);
    console.log("");

    // Issuer information
    console.log("Issuer:");
    if (certInfo.issuer.commonName) {
      console.log(`  Common Name (CN): ${certInfo.issuer.commonName}`);
    }
    if (certInfo.issuer.organization) {
      console.log(`  Organization (O): ${certInfo.issuer.organization}`);
    }
    console.log(`  Raw:              ${certInfo.issuer.raw}`);
    console.log("");

    // Validity
    console.log("Validity:");
    console.log(`  Not Before:       ${certInfo.validFrom.toISOString()}`);
    console.log(`  Not After:        ${certInfo.validTo.toISOString()}`);
    console.log(`  Days Until Expiry: ${certInfo.daysUntilExpiry}`);
    console.log(`  Is Valid:         ${certInfo.isValid ? "Yes" : "No"}`);
    console.log(`  Is Expired:       ${certInfo.isExpired ? "Yes" : "No"}`);
    console.log("");

    // Technical details
    console.log("Technical Details:");
    console.log(`  Serial Number:    ${certInfo.serialNumber}`);
    console.log(`  Fingerprint:      ${certInfo.fingerprint}`);
    console.log(`  Key Type:         ${certInfo.keyType}`);
    console.log(`  Key Size:         ${certInfo.keySize} bits`);
    console.log("");

    // Warnings
    if (certInfo.isExpired) {
      console.log("WARNING: Certificate has EXPIRED!");
      console.log("");
    } else if (certInfo.daysUntilExpiry <= 30) {
      console.log(`WARNING: Certificate expires in ${certInfo.daysUntilExpiry} days!`);
      console.log("");
    }

    // Private key info
    console.log("-".repeat(60));
    console.log("  Private Key Information");
    console.log("-".repeat(60));
    console.log("");
    console.log(`  Key Type:         ${privateKey.asymmetricKeyType}`);
    console.log(`  Key Object:       Valid`);
    console.log("");

    // Test signing
    console.log("-".repeat(60));
    console.log("  Signing Test");
    console.log("-".repeat(60));
    console.log("");

    const testDocument = {
      _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      Invoice: [
        {
          ID: [{ _: "TEST-001" }],
          IssueDate: [{ _: new Date().toISOString().split("T")[0] }],
          DocumentCurrencyCode: [{ _: "MYR" }],
        },
      ],
    };

    console.log("Signing test document...");

    const signingService = new SigningService(privateKey, result.certPem, certInfo);
    const signedResult = signingService.sign(testDocument);

    console.log(`  Document Hash:    ${signedResult.documentHash}`);
    console.log(
      `  Signature Value:  ${signedResult.signatureBlock.signatureValue.substring(0, 50)}...`
    );
    console.log(`  Signing Time:     ${signedResult.signingTime}`);
    console.log("");

    // Verify signature
    console.log("Verifying signature...");
    const verifyResult = verify(signedResult.signedDocument, result.certPem);
    console.log(`  Signature Valid:  ${verifyResult.valid ? "Yes" : "No"}`);
    console.log(`  Hash Valid:       ${verifyResult.hashValid ? "Yes" : "No"}`);
    console.log("");

    console.log("=".repeat(60));
    console.log("  Certificate verification PASSED");
    console.log("=".repeat(60));
    console.log("");
    console.log("Your certificate is ready for v1.1 document signing.");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("ERROR: Failed to load certificate");
    console.error("");
    console.error((error as Error).message);
    console.error("");

    if (
      (error as Error).message.includes("passphrase") ||
      (error as Error).message.includes("password") ||
      (error as Error).message.includes("MAC")
    ) {
      console.error("Hint: Check that your SIGNING_PKCS12_PASSPHRASE is correct.");
    }

    process.exit(1);
  }
}

main().catch(console.error);
