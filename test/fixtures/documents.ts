/**
 * Test Fixtures - Documents
 *
 * Minimal document fixtures for testing.
 */

/**
 * Create a minimal valid document payload
 */
export function createDocumentPayload(codeNumber: string = "INV-001"): {
  codeNumber: string;
  document: string;
} {
  // Create a minimal base64 "document" - just enough to pass size checks
  // In real tests, this would be a properly formatted UBL invoice
  const content = JSON.stringify({
    invoiceNumber: codeNumber,
    issueDate: new Date().toISOString(),
    issuerTin: "C12345678901",
    total: 1000.0,
  });

  return {
    codeNumber,
    document: Buffer.from(content).toString("base64"),
  };
}

/**
 * Create multiple document payloads
 */
export function createDocumentPayloads(
  count: number,
  prefix: string = "INV"
): Array<{ codeNumber: string; document: string }> {
  return Array.from({ length: count }, (_, i) =>
    createDocumentPayload(`${prefix}-${String(i + 1).padStart(3, "0")}`)
  );
}

/**
 * Create a large document (for size limit testing)
 * Generates a document close to 300KB
 */
export function createLargeDocument(codeNumber: string = "LARGE-001"): {
  codeNumber: string;
  document: string;
} {
  // Create content that's about 280KB when base64 encoded
  const padding = "x".repeat(200 * 1024);
  const content = JSON.stringify({
    invoiceNumber: codeNumber,
    padding,
  });

  return {
    codeNumber,
    document: Buffer.from(content).toString("base64"),
  };
}

/**
 * Create an oversized document (for rejection testing)
 * Generates a document over 300KB
 */
export function createOversizedDocument(codeNumber: string = "OVERSIZED-001"): {
  codeNumber: string;
  document: string;
} {
  // Create content that's about 350KB when base64 encoded
  const padding = "x".repeat(300 * 1024);
  const content = JSON.stringify({
    invoiceNumber: codeNumber,
    padding,
  });

  return {
    codeNumber,
    document: Buffer.from(content).toString("base64"),
  };
}
