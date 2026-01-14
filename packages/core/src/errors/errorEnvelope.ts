/**
 * Unified Error Envelope
 *
 * This is the canonical error structure returned by the gateway for all 4xx/5xx responses.
 * All MyInvois-specific errors are normalized into this structure.
 *
 * ERROR NORMALIZATION SUMMARY:
 * ============================
 * - MyInvois validation errors (step validators) → mapped to specific error codes
 * - HTTP 4xx/5xx from upstream → mapped to UPSTREAM_* codes
 * - Local validation failures → mapped to VALIDATION_* codes
 * - Auth failures → mapped to AUTH_* codes
 *
 * RETRYABLE ERRORS:
 * - UPSTREAM_TIMEOUT, UPSTREAM_ERROR, UPSTREAM_RATE_LIMITED → retryable = true
 * - Business validation errors (DUPLICATE, INVALID_TAXPAYER) → retryable = false
 */

/**
 * Internal error codes used by the middleware.
 * These are stable machine-readable codes that clients can rely on.
 */
export const ErrorCodes = {
  // Business validation failures from MyInvois
  DUPLICATE_SUBMISSION: "DUPLICATE_SUBMISSION",
  INVALID_TAXPAYER: "INVALID_TAXPAYER",
  INVALID_TOTALS: "INVALID_TOTALS",
  INVALID_DOCUMENT_RELATION: "INVALID_DOCUMENT_RELATION",
  INVALID_DOCUMENT_STRUCTURE: "INVALID_DOCUMENT_STRUCTURE",
  DOCUMENT_VALIDATION_FAILED: "DOCUMENT_VALIDATION_FAILED",

  // Infrastructure / platform failures
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  UPSTREAM_RATE_LIMITED: "UPSTREAM_RATE_LIMITED",
  NETWORK_ERROR: "NETWORK_ERROR",

  // Auth / session failures
  AUTH_INVALID_CLIENT: "AUTH_INVALID_CLIENT",
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  AUTH_UNAVAILABLE: "AUTH_UNAVAILABLE",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_EXPIRED: "SESSION_EXPIRED",

  // Local validation / guardrails
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  DOCUMENT_TOO_LARGE: "DOCUMENT_TOO_LARGE",
  TOO_MANY_DOCUMENTS: "TOO_MANY_DOCUMENTS",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",

  // Signing errors (2001-2010) - local middleware errors
  SIGNING_DISABLED: "SIGNING_DISABLED",
  CERTIFICATE_LOAD_FAILED: "CERTIFICATE_LOAD_FAILED",
  PRIVATE_KEY_LOAD_FAILED: "PRIVATE_KEY_LOAD_FAILED",
  CERTIFICATE_EXPIRED: "CERTIFICATE_EXPIRED",
  CERTIFICATE_NOT_YET_VALID: "CERTIFICATE_NOT_YET_VALID",
  KEY_CERTIFICATE_MISMATCH: "KEY_CERTIFICATE_MISMATCH",
  SIGNING_FAILED: "SIGNING_FAILED",
  SIGNATURE_VERIFICATION_FAILED: "SIGNATURE_VERIFICATION_FAILED",
  INVALID_DOCUMENT_VERSION: "INVALID_DOCUMENT_VERSION",
  SIGNING_NOT_CONFIGURED: "SIGNING_NOT_CONFIGURED",

  // Signing errors from MyInvois upstream - signature validation failures
  SIGNING_REQUIRED: "SIGNING_REQUIRED",
  DIGEST_MISMATCH: "DIGEST_MISMATCH",
  SIGNATURE_INVALID: "SIGNATURE_INVALID",
  CERTIFICATE_REJECTED: "CERTIFICATE_REJECTED",

  // Generic errors
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  BAD_REQUEST: "BAD_REQUEST",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Upstream error context - captures details from MyInvois
 */
export interface UpstreamErrorContext {
  /** Source of the error */
  source: "MYINVOIS" | "MIDDLEWARE";
  /** Original HTTP status from upstream (if available) */
  status?: number;
  /** MyInvois error code (e.g., "ERR045") */
  errorCode?: string;
  /** MyInvois error name/step (e.g., "Step05-Taxpayer Profile Validator") */
  errorName?: string;
  /** Request path that failed */
  path?: string;
  /** HTTP method */
  method?: string;
}

/**
 * Unified Error Envelope
 *
 * This structure is returned for all 4xx/5xx responses from the gateway.
 * Clients should rely on the `code` field for programmatic error handling.
 */
export interface ErrorEnvelope {
  /** Internal error code (e.g., "DUPLICATE_SUBMISSION", "INVALID_TAXPAYER") */
  code: ErrorCode | string;
  /** Human-readable English message */
  messageEN: string;
  /** HTTP status code to send to client */
  httpStatus: number;
  /** Whether clients should automatically retry this request */
  retryable: boolean;
  /** Upstream error context (if error originated from MyInvois) */
  upstream?: UpstreamErrorContext;
  /** Field that caused the error (e.g., "Customer.TIN") */
  field?: string;
  /** Property path for validation errors (e.g., "documents[0].Customer.TIN") */
  propertyPath?: string;
  /** Gateway correlation ID for debugging */
  correlationId?: string;
  /** Submission tracking ID (if applicable) */
  trackingId?: string;
  /** Retry-after in seconds (for rate limiting) */
  retryAfterSeconds?: number;
  /** Additional error details */
  details?: ErrorEnvelopeDetail[];
}

/**
 * Additional error detail (for multi-error responses)
 */
export interface ErrorEnvelopeDetail {
  code: string;
  messageEN: string;
  field?: string;
  propertyPath?: string;
}

/**
 * HTTP response wrapper for error envelope
 */
export interface ErrorEnvelopeResponse {
  error: ErrorEnvelope;
}

/**
 * Create an error envelope with defaults
 */
export function createErrorEnvelope(
  code: ErrorCode | string,
  messageEN: string,
  httpStatus: number,
  options: Partial<Omit<ErrorEnvelope, "code" | "messageEN" | "httpStatus">> = {}
): ErrorEnvelope {
  return {
    code,
    messageEN,
    httpStatus,
    retryable: options.retryable ?? false,
    ...options,
  };
}

/**
 * Create an error envelope response (wrapped in { error: ... })
 */
export function createErrorEnvelopeResponse(
  envelope: ErrorEnvelope
): ErrorEnvelopeResponse {
  return { error: envelope };
}

/**
 * Check if an error is retryable based on its code
 */
export function isRetryableError(code: string): boolean {
  const retryableCodes: Set<string> = new Set([
    ErrorCodes.UPSTREAM_TIMEOUT,
    ErrorCodes.UPSTREAM_ERROR,
    ErrorCodes.UPSTREAM_RATE_LIMITED,
    ErrorCodes.NETWORK_ERROR,
    ErrorCodes.AUTH_UNAVAILABLE,
  ]);
  return retryableCodes.has(code);
}

/**
 * Get recommended HTTP status for an error code
 */
export function getHttpStatusForCode(code: string): number {
  const statusMap: Record<string, number> = {
    // Business validation - 400 Bad Request or 409 Conflict
    [ErrorCodes.DUPLICATE_SUBMISSION]: 409,
    [ErrorCodes.INVALID_TAXPAYER]: 400,
    [ErrorCodes.INVALID_TOTALS]: 400,
    [ErrorCodes.INVALID_DOCUMENT_RELATION]: 400,
    [ErrorCodes.INVALID_DOCUMENT_STRUCTURE]: 400,
    [ErrorCodes.DOCUMENT_VALIDATION_FAILED]: 400,

    // Infrastructure - 5xx
    [ErrorCodes.UPSTREAM_TIMEOUT]: 504,
    [ErrorCodes.UPSTREAM_ERROR]: 502,
    [ErrorCodes.UPSTREAM_RATE_LIMITED]: 429,
    [ErrorCodes.NETWORK_ERROR]: 503,

    // Auth - 401/403
    [ErrorCodes.AUTH_INVALID_CLIENT]: 401,
    [ErrorCodes.AUTH_INVALID_CREDENTIALS]: 401,
    [ErrorCodes.AUTH_TOKEN_EXPIRED]: 401,
    [ErrorCodes.AUTH_UNAVAILABLE]: 503,
    [ErrorCodes.SESSION_NOT_FOUND]: 404,
    [ErrorCodes.SESSION_EXPIRED]: 401,

    // Local validation - 400/413/409
    [ErrorCodes.PAYLOAD_TOO_LARGE]: 413,
    [ErrorCodes.DOCUMENT_TOO_LARGE]: 413,
    [ErrorCodes.TOO_MANY_DOCUMENTS]: 400,
    [ErrorCodes.VALIDATION_ERROR]: 400,
    [ErrorCodes.IDEMPOTENCY_CONFLICT]: 409,
    [ErrorCodes.MISSING_REQUIRED_FIELD]: 400,

    // Signing errors (local) - 400/500/503
    [ErrorCodes.SIGNING_DISABLED]: 503,
    [ErrorCodes.CERTIFICATE_LOAD_FAILED]: 500,
    [ErrorCodes.PRIVATE_KEY_LOAD_FAILED]: 500,
    [ErrorCodes.CERTIFICATE_EXPIRED]: 503,
    [ErrorCodes.CERTIFICATE_NOT_YET_VALID]: 503,
    [ErrorCodes.KEY_CERTIFICATE_MISMATCH]: 500,
    [ErrorCodes.SIGNING_FAILED]: 500,
    [ErrorCodes.SIGNATURE_VERIFICATION_FAILED]: 400,
    [ErrorCodes.INVALID_DOCUMENT_VERSION]: 400,
    [ErrorCodes.SIGNING_NOT_CONFIGURED]: 503,

    // Signing errors (from MyInvois upstream) - 400
    [ErrorCodes.SIGNING_REQUIRED]: 400,
    [ErrorCodes.DIGEST_MISMATCH]: 400,
    [ErrorCodes.SIGNATURE_INVALID]: 400,
    [ErrorCodes.CERTIFICATE_REJECTED]: 400,

    // Generic
    [ErrorCodes.NOT_FOUND]: 404,
    [ErrorCodes.FORBIDDEN]: 403,
    [ErrorCodes.BAD_REQUEST]: 400,
    [ErrorCodes.INTERNAL_ERROR]: 500,
  };

  return statusMap[code] ?? 500;
}
