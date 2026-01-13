import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { SigningService, loadPKCS12 } from "../packages/signing/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env") });

const p12Path = process.env.SIGNING_PKCS12_PATH || "";
const p12Pass = process.env.SIGNING_PKCS12_PASSPHRASE || "";

const p12 = loadPKCS12({ path: p12Path, passphrase: p12Pass });
const signer = new SigningService(p12.privateKey, p12.certPem, p12.certInfo);

const invoice = {
  "_D": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  "_A": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  "_B": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  "Invoice": [{ "ID": [{"_": "TEST"}] }]
};

const result = signer.sign(invoice);
console.log("=== SIGNED DOCUMENT STRUCTURE ===");
console.log(JSON.stringify(result.signedDocument, null, 2));
