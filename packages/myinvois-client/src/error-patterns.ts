/**
 * Error Patterns for MyInvois Error Normalization
 *
 * Known MyInvois error patterns for pattern matching against
 * validation steps, signature errors, and authentication failures.
 */

import { ErrorCodes } from "@myinvois/core";

/**
 * Known MyInvois error patterns for pattern matching
 */
export interface ErrorPattern {
  /** Pattern to match against step name or error message */
  pattern: RegExp | string;
  /** Internal error code to use */
  code: string;
  /** Default HTTP status (can be overridden) */
  httpStatus: number;
  /** Whether this error is retryable */
  retryable: boolean;
  /** Human-readable message template */
  messageTemplate: string;
  /** Field extractor (optional) */
  extractField?: (body: unknown, message: string) => string | undefined;
}

/**
 * Error patterns for MyInvois validation steps
 */
export const VALIDATION_STEP_PATTERNS: ErrorPattern[] = [
  {
    pattern: /duplicat(ed?|ion)\s*(submission|validator)/i,
    code: ErrorCodes.DUPLICATE_SUBMISSION,
    httpStatus: 409,
    retryable: false,
    messageTemplate:
      "This document has already been submitted. Each invoice can only be submitted once.",
  },
  {
    pattern: /taxpayer\s*profile\s*validator/i,
    code: ErrorCodes.INVALID_TAXPAYER,
    httpStatus: 400,
    retryable: false,
    messageTemplate:
      "Invalid taxpayer information. Please verify the TIN before issuing the invoice.",
  },
  {
    pattern: /amount.*total|total.*validator/i,
    code: ErrorCodes.INVALID_TOTALS,
    httpStatus: 400,
    retryable: false,
    messageTemplate:
      "Invoice totals do not match line items. Please verify calculations and resubmit.",
  },
  {
    pattern: /document\s*relation\s*validator/i,
    code: ErrorCodes.INVALID_DOCUMENT_RELATION,
    httpStatus: 400,
    retryable: false,
    messageTemplate:
      "Invalid document reference. Credit notes and debit notes must reference a valid original invoice.",
  },
  {
    pattern: /document\s*structure\s*validator|format\s*validation/i,
    code: ErrorCodes.INVALID_DOCUMENT_STRUCTURE,
    httpStatus: 400,
    retryable: false,
    messageTemplate:
      "Invalid document structure. Please verify the document format and required fields.",
  },
];

/**
 * Error patterns for signature validation failures from MyInvois
 */
export const SIGNATURE_ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /signature.*missing|missing.*signature|no.*signature|signature.*required/i,
    code: ErrorCodes.SIGNING_REQUIRED,
    httpStatus: 400,
    retryable: false,
    messageTemplate: "Document signature is required. Please sign the document before submission.",
  },
  {
    pattern: /digest.*mismatch|digest.*invalid|invalid.*digest|digestvalue.*invalid/i,
    code: ErrorCodes.DIGEST_MISMATCH,
    httpStatus: 400,
    retryable: false,
    messageTemplate:
      "Document digest does not match. The document may have been modified after signing.",
  },
  {
    pattern:
      /signature.*invalid|invalid.*signature|signature.*verification.*fail|signaturevalue.*invalid/i,
    code: ErrorCodes.SIGNATURE_INVALID,
    httpStatus: 400,
    retryable: false,
    messageTemplate:
      "Document signature is invalid. Please verify the signing certificate and re-sign.",
  },
  {
    pattern:
      /certificate.*invalid|invalid.*certificate|certificate.*reject|certificate.*untrusted|certificate.*expired/i,
    code: ErrorCodes.CERTIFICATE_REJECTED,
    httpStatus: 400,
    retryable: false,
    messageTemplate:
      "Signing certificate was rejected. Please verify your certificate is valid and trusted.",
  },
];

/**
 * Error patterns for authentication failures
 */
export const AUTH_ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /invalid_client|invalid\s*client/i,
    code: ErrorCodes.AUTH_INVALID_CLIENT,
    httpStatus: 401,
    retryable: false,
    messageTemplate: "Invalid client credentials. Please verify your client ID and secret.",
  },
  {
    pattern: /invalid_grant|invalid\s*credentials/i,
    code: ErrorCodes.AUTH_INVALID_CREDENTIALS,
    httpStatus: 401,
    retryable: false,
    messageTemplate: "Invalid credentials provided.",
  },
  {
    pattern: /token.*expired|expired.*token/i,
    code: ErrorCodes.AUTH_TOKEN_EXPIRED,
    httpStatus: 401,
    retryable: true,
    messageTemplate: "Authentication token has expired. The system will attempt to refresh.",
  },
];
