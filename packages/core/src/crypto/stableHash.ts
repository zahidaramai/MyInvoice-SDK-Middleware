/**
 * Stable hashing utilities for fingerprinting
 */

import { createHash } from "node:crypto";

/**
 * Generate a stable SHA-256 hash of the input
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Generate a truncated hash (first N characters)
 */
export function sha256Short(input: string, length = 12): string {
  return sha256(input).slice(0, length);
}

/**
 * Generate a session fingerprint from key components
 * Used for logging and correlation without exposing secrets
 */
export function sessionFingerprint(
  env: string,
  mode: string,
  clientId: string,
  onBehalfOf?: string
): string {
  const components = [env, mode, clientId, onBehalfOf ?? ""].join(":");
  return sha256Short(components);
}

/**
 * Compute document hash for MyInvois submission.
 *
 * IMPORTANT: MyInvois requires the documentHash to be:
 * - SHA-256 hash of the JSON string (UTF-8 encoded)
 * - Encoded as HEXADECIMAL (not base64!)
 *
 * @param jsonString - The JSON string to hash (already stringified document)
 * @returns Hex-encoded SHA-256 hash
 *
 * @example
 * ```ts
 * const signedDoc = signer.sign(invoice);
 * const jsonString = JSON.stringify(signedDoc.signedDocument);
 * const documentHash = computeDocumentHash(jsonString);
 * const documentBase64 = Buffer.from(jsonString, 'utf-8').toString('base64');
 *
 * // Submit to MyInvois:
 * { format: 'JSON', document: documentBase64, documentHash, codeNumber }
 * ```
 */
export function computeDocumentHash(jsonString: string): string {
  return createHash("sha256").update(jsonString, "utf-8").digest("hex");
}

/**
 * Prepare a signed document for MyInvois submission.
 *
 * Returns both the base64-encoded document and the hex-encoded hash
 * ready for the MyInvois Submit Documents API.
 *
 * @param signedDocument - The signed document object
 * @returns Object with document (base64) and documentHash (hex)
 */
export function prepareDocumentForSubmission(signedDocument: Record<string, unknown>): {
  document: string;
  documentHash: string;
} {
  const jsonString = JSON.stringify(signedDocument);
  return {
    document: Buffer.from(jsonString, "utf-8").toString("base64"),
    documentHash: computeDocumentHash(jsonString),
  };
}
