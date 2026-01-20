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
 * Remove UBLExtensions and Signature from a document element
 * Handles both array-wrapped (MyInvois format) and object formats
 *
 * Both UBLExtensions and Signature blocks must be excluded from the document
 * hash calculation as they are added during the signing process.
 */
function removeSignatureElementsFromElement(element: unknown): unknown {
  if (!element || typeof element !== 'object') {
    return element;
  }

  // Handle array-wrapped documents (MyInvois format: Invoice: [{UBLExtensions: [...], ...}])
  if (Array.isArray(element)) {
    return element.map((item, index) => {
      if (index === 0 && typeof item === 'object' && item !== null) {
        const obj = { ...(item as Record<string, unknown>) };
        delete obj.UBLExtensions;
        delete obj.Signature;
        return obj;
      }
      return item;
    });
  }

  // Handle object-wrapped documents (simple format: Invoice: {UBLExtensions: {...}, ...})
  const obj = { ...(element as Record<string, unknown>) };
  delete obj.UBLExtensions;
  delete obj.Signature;
  return obj;
}

/**
 * Remove signature elements from document for hashing
 * Both UBLExtensions and Signature blocks must be excluded from the hash
 */
function removeSignatureExtension(doc: Record<string, unknown>): Record<string, unknown> {
  const result = { ...doc };

  // Handle Invoice wrapper
  if (result.Invoice) {
    result.Invoice = removeSignatureElementsFromElement(result.Invoice);
    return result;
  }

  // Handle CreditNote wrapper
  if (result.CreditNote) {
    result.CreditNote = removeSignatureElementsFromElement(result.CreditNote);
    return result;
  }

  // Handle DebitNote wrapper
  if (result.DebitNote) {
    result.DebitNote = removeSignatureElementsFromElement(result.DebitNote);
    return result;
  }

  // Handle direct document without wrapper
  if (result.UBLExtensions) {
    delete result.UBLExtensions;
  }
  if (result.Signature) {
    delete result.Signature;
  }

  return result;
}

/**
 * Canonicalize a document for consistent hashing
 *
 * This function:
 * 1. Removes the UBLExtensions (signature block location)
 * 2. Serializes to JSON without whitespace
 *
 * Per LHDN MyInvois SDK documentation, the document hash should use standard
 * JSON.stringify() output WITHOUT key sorting. This differs from some XML
 * canonicalization standards.
 *
 * @param document - The document to canonicalize
 * @returns Canonicalized JSON string
 */
export function canonicalizeDocument(document: Record<string, unknown>): string {
  // Remove signature extension
  const docWithoutSig = removeSignatureExtension(document);

  // Serialize without whitespace - NO key sorting per MyInvois SDK spec
  return JSON.stringify(docWithoutSig);
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
