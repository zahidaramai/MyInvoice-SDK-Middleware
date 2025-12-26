/**
 * Submission utilities for document validation and payload processing
 */

import { sha256 } from "@myinvois/core";

/**
 * Submission constraints from MyInvois SDK
 */
export const SUBMISSION_CONSTRAINTS = {
  /** Maximum number of documents per submission */
  MAX_DOCUMENTS: 100,
  /** Maximum size of each document in bytes (300KB) */
  MAX_DOCUMENT_SIZE_BYTES: 300 * 1024,
  /** Maximum total submission payload size in bytes (5MB) */
  MAX_SUBMISSION_SIZE_BYTES: 5 * 1024 * 1024,
  /** Idempotency window in minutes */
  IDEMPOTENCY_WINDOW_MINUTES: 10,
} as const;

/**
 * Document format type
 */
export type DocumentFormat = "XML" | "JSON";

/**
 * Document input from gateway request
 */
export interface GatewayDocumentInput {
  format: DocumentFormat;
  codeNumber: string;
  /** Raw document content (gateway will encode) */
  rawDocument?: string;
  /** Pre-encoded base64 document */
  documentBase64?: string;
  /** Pre-computed SHA256 hash */
  documentHashSha256?: string;
}

/**
 * Prepared document ready for upstream submission
 */
export interface PreparedDocument {
  format: DocumentFormat;
  codeNumber: string;
  /** Base64-encoded document content */
  document: string;
  /** SHA256 hash of document content */
  documentHash: string;
  /** Estimated size in bytes */
  estimatedSizeBytes: number;
}

/**
 * Validation error for submission
 */
export interface SubmissionValidationError {
  code: string;
  message: string;
  propertyPath?: string;
}

/**
 * Estimate decoded size from base64 string length
 * Base64 encoding increases size by ~33%, so decoded = encoded * 3/4
 */
export function estimateBase64DecodedSize(base64Length: number): number {
  // Remove padding characters from calculation
  return Math.floor((base64Length * 3) / 4);
}

/**
 * Encode string to base64
 */
export function encodeBase64(content: string): string {
  return Buffer.from(content, "utf-8").toString("base64");
}

/**
 * Calculate SHA256 hash of content
 */
export function hashDocument(content: string): string {
  return sha256(content);
}

/**
 * Prepare a document for submission
 * Handles both raw and pre-encoded documents
 */
export function prepareDocument(input: GatewayDocumentInput): PreparedDocument {
  let document: string;
  let documentHash: string;
  let estimatedSizeBytes: number;

  if (input.documentBase64) {
    // Use pre-encoded document
    document = input.documentBase64;
    documentHash = input.documentHashSha256 || hashDocument(input.documentBase64);
    estimatedSizeBytes = estimateBase64DecodedSize(input.documentBase64.length);
  } else if (input.rawDocument) {
    // Encode raw document
    document = encodeBase64(input.rawDocument);
    documentHash = input.documentHashSha256 || hashDocument(input.rawDocument);
    estimatedSizeBytes = Buffer.byteLength(input.rawDocument, "utf-8");
  } else {
    throw new Error("Either rawDocument or documentBase64 must be provided");
  }

  return {
    format: input.format,
    codeNumber: input.codeNumber,
    document,
    documentHash,
    estimatedSizeBytes,
  };
}

/**
 * Validate submission constraints
 * Returns array of validation errors (empty if valid)
 */
export function validateSubmissionConstraints(
  documents: PreparedDocument[]
): SubmissionValidationError[] {
  const errors: SubmissionValidationError[] = [];

  // Check document count
  if (documents.length === 0) {
    errors.push({
      code: "NO_DOCUMENTS",
      message: "At least one document is required",
      propertyPath: "documents",
    });
  }

  if (documents.length > SUBMISSION_CONSTRAINTS.MAX_DOCUMENTS) {
    errors.push({
      code: "TOO_MANY_DOCUMENTS",
      message: `Maximum ${SUBMISSION_CONSTRAINTS.MAX_DOCUMENTS} documents allowed per submission`,
      propertyPath: "documents",
    });
  }

  // Check individual document sizes
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (doc.estimatedSizeBytes > SUBMISSION_CONSTRAINTS.MAX_DOCUMENT_SIZE_BYTES) {
      errors.push({
        code: "DOCUMENT_TOO_LARGE",
        message: `Document exceeds maximum size of ${SUBMISSION_CONSTRAINTS.MAX_DOCUMENT_SIZE_BYTES / 1024}KB`,
        propertyPath: `documents[${i}]`,
      });
    }
  }

  // Check total submission size
  const totalSize = documents.reduce((sum, doc) => sum + doc.estimatedSizeBytes, 0);
  if (totalSize > SUBMISSION_CONSTRAINTS.MAX_SUBMISSION_SIZE_BYTES) {
    errors.push({
      code: "SUBMISSION_TOO_LARGE",
      message: `Total submission exceeds maximum size of ${SUBMISSION_CONSTRAINTS.MAX_SUBMISSION_SIZE_BYTES / (1024 * 1024)}MB`,
      propertyPath: "documents",
    });
  }

  return errors;
}

/**
 * Compute canonical payload hash for deduplication
 * Uses stable JSON stringification with sorted keys
 */
export function computePayloadHash(documents: PreparedDocument[]): string {
  // Create canonical representation: array of {codeNumber, documentHash} sorted by codeNumber
  const canonical = documents
    .map((doc) => ({
      codeNumber: doc.codeNumber,
      documentHash: doc.documentHash,
    }))
    .sort((a, b) => a.codeNumber.localeCompare(b.codeNumber));

  // Stringify with sorted keys (already sorted array)
  const json = JSON.stringify(canonical);
  return sha256(json);
}

/**
 * Generate a unique tracking ID for submissions
 */
export function generateTrackingId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 9);
  return `trk_${timestamp}${random}`;
}

/**
 * Validate tracking ID format
 */
export function isValidTrackingId(id: string): boolean {
  return /^trk_[a-zA-Z0-9]+$/.test(id);
}
