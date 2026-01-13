import * as crypto from 'crypto';

/**
 * Sort object keys recursively for deterministic JSON serialization
 */
function sortKeysRecursively(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortKeysRecursively);
  }

  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();

    for (const key of keys) {
      sorted[key] = sortKeysRecursively((obj as Record<string, unknown>)[key]);
    }

    return sorted;
  }

  return obj;
}

/**
 * Remove UBLExtensions from document for hashing
 * The signature block is stored in UBLExtensions and must be excluded from the hash
 */
function removeSignatureExtension(doc: Record<string, unknown>): Record<string, unknown> {
  const result = { ...doc };

  // Handle Invoice wrapper
  if (result.Invoice && typeof result.Invoice === 'object') {
    const invoice = { ...(result.Invoice as Record<string, unknown>) };
    delete invoice.UBLExtensions;
    result.Invoice = invoice;
    return result;
  }

  // Handle CreditNote wrapper
  if (result.CreditNote && typeof result.CreditNote === 'object') {
    const creditNote = { ...(result.CreditNote as Record<string, unknown>) };
    delete creditNote.UBLExtensions;
    result.CreditNote = creditNote;
    return result;
  }

  // Handle DebitNote wrapper
  if (result.DebitNote && typeof result.DebitNote === 'object') {
    const debitNote = { ...(result.DebitNote as Record<string, unknown>) };
    delete debitNote.UBLExtensions;
    result.DebitNote = debitNote;
    return result;
  }

  // Handle direct document without wrapper
  if (result.UBLExtensions) {
    delete result.UBLExtensions;
  }

  return result;
}

/**
 * Canonicalize a document for consistent hashing
 *
 * This function:
 * 1. Removes the UBLExtensions (signature block location)
 * 2. Sorts all object keys recursively
 * 3. Serializes to JSON without whitespace
 *
 * @param document - The document to canonicalize
 * @returns Canonicalized JSON string
 */
export function canonicalizeDocument(document: Record<string, unknown>): string {
  // Remove signature extension
  const docWithoutSig = removeSignatureExtension(document);

  // Sort keys recursively
  const sorted = sortKeysRecursively(docWithoutSig);

  // Serialize without whitespace
  return JSON.stringify(sorted);
}

/**
 * Generate SHA-256 hash of a document
 *
 * @param document - The document to hash
 * @returns Base64-encoded SHA-256 hash
 */
export function generateDocumentHash(document: Record<string, unknown>): string {
  const canonicalized = canonicalizeDocument(document);
  const hash = crypto.createHash('sha256').update(canonicalized, 'utf8').digest();
  return hash.toString('base64');
}

/**
 * Generate SHA-256 hash of a string
 *
 * @param data - The string to hash
 * @returns Base64-encoded SHA-256 hash
 */
export function hashString(data: string): string {
  const hash = crypto.createHash('sha256').update(data, 'utf8').digest();
  return hash.toString('base64');
}

/**
 * Generate SHA-256 hash and return as hex string
 *
 * @param document - The document to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function generateDocumentHashHex(document: Record<string, unknown>): string {
  const canonicalized = canonicalizeDocument(document);
  const hash = crypto.createHash('sha256').update(canonicalized, 'utf8').digest();
  return hash.toString('hex');
}

/**
 * Verify that a document hash matches an expected value
 *
 * @param document - The document to verify
 * @param expectedHash - The expected base64-encoded hash
 * @returns True if hash matches
 */
export function verifyDocumentHash(
  document: Record<string, unknown>,
  expectedHash: string
): boolean {
  const computedHash = generateDocumentHash(document);
  return computedHash === expectedHash;
}

// Export internal functions for testing
export { sortKeysRecursively as _sortKeysRecursively };
export { removeSignatureExtension as _removeSignatureExtension };
