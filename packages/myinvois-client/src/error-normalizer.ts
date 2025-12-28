/**
 * Error Normalizer
 *
 * Central module for normalizing MyInvois API errors into the unified ErrorEnvelope format.
 * All upstream errors should be processed through this normalizer to ensure consistent
 * error handling across the gateway.
 *
 * ERROR NORMALIZATION LOCATION:
 * =============================
 * This file is the canonical location for error normalization. When MyInvois returns an error,
 * it should be processed through `normalizeMyinvoisError()` to produce a consistent ErrorEnvelope.
 *
 * EXPECTED ERROR SHAPE:
 * =====================
 * All errors returned to clients conform to the ErrorEnvelope interface:
 * - code: Stable internal code (e.g., "DUPLICATE_SUBMISSION")
 * - message: Human-readable English message
 * - httpStatus: HTTP status code for the response
 * - retryable: Whether the client should retry
 * - upstream: Context about the original MyInvois error
 * - field/propertyPath: Location of the error (for validation errors)
 */

import {
  type ErrorEnvelope,
  type UpstreamErrorContext,
  ErrorCodes,
  createErrorEnvelope,
} from "@myinvois/core";

/**
 * Raw error input from MyInvois API response
 */
export interface MyInvoisErrorInput {
  /** HTTP status from upstream */
  httpStatus: number;
  /** Response body (parsed or raw) */
  body?: unknown;
  /** Validation step name (e.g., "Step05-Taxpayer Profile Validator") */
  stepName?: string;
  /** MyInvois error code (e.g., "ERR045") */
  errorCode?: string;
  /** Request path that failed */
  path?: string;
  /** HTTP method */
  method?: string;
  /** Correlation ID from upstream */
  correlationId?: string;
}

/**
 * Known MyInvois error patterns for pattern matching
 */
interface ErrorPattern {
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
const VALIDATION_STEP_PATTERNS: ErrorPattern[] = [
  {
    pattern: /duplicat(ed?|ion)\s*(submission|validator)/i,
    code: ErrorCodes.DUPLICATE_SUBMISSION,
    httpStatus: 409,
    retryable: false,
    messageTemplate: "This document has already been submitted. Each invoice can only be submitted once.",
  },
  {
    pattern: /taxpayer\s*profile\s*validator/i,
    code: ErrorCodes.INVALID_TAXPAYER,
    httpStatus: 400,
    retryable: false,
    messageTemplate: "Invalid taxpayer information. Please verify the TIN before issuing the invoice.",
    extractField: extractTinField,
  },
  {
    pattern: /amount.*total|total.*validator/i,
    code: ErrorCodes.INVALID_TOTALS,
    httpStatus: 400,
    retryable: false,
    messageTemplate: "Invoice totals do not match line items. Please verify calculations and resubmit.",
  },
  {
    pattern: /document\s*relation\s*validator/i,
    code: ErrorCodes.INVALID_DOCUMENT_RELATION,
    httpStatus: 400,
    retryable: false,
    messageTemplate: "Invalid document reference. Credit notes and debit notes must reference a valid original invoice.",
  },
  {
    pattern: /document\s*structure\s*validator|format\s*validation/i,
    code: ErrorCodes.INVALID_DOCUMENT_STRUCTURE,
    httpStatus: 400,
    retryable: false,
    messageTemplate: "Invalid document structure. Please verify the document format and required fields.",
  },
];

/**
 * Error patterns for authentication failures
 */
const AUTH_ERROR_PATTERNS: ErrorPattern[] = [
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

/**
 * Extract TIN field from error body or message
 */
function extractTinField(body: unknown, message: string): string | undefined {
  // First, try to extract from validationSteps structure (real MyInvois format)
  const parsedStep = parseValidationSteps(body);
  if (parsedStep?.propertyName) {
    return parsedStep.propertyName;
  }

  // Then try to extract from body at root level
  if (body && typeof body === "object") {
    const bodyObj = body as Record<string, unknown>;
    if (bodyObj.propertyName && typeof bodyObj.propertyName === "string") {
      return bodyObj.propertyName;
    }
    if (bodyObj.propertyPath && typeof bodyObj.propertyPath === "string") {
      return bodyObj.propertyPath;
    }
  }

  // Fallback: Try to extract from message patterns
  const tinPatterns = [
    /buyer.*tin/i,
    /customer.*tin/i,
    /receiver.*tin/i,
    /taxpayer.*tin/i,
  ];

  for (const pattern of tinPatterns) {
    if (pattern.test(message)) {
      if (/buyer|customer/i.test(message)) return "Customer.TIN";
      if (/receiver/i.test(message)) return "Receiver.TIN";
      if (/taxpayer|seller|supplier/i.test(message)) return "Supplier.TIN";
    }
  }

  // No field information available
  return undefined;
}

/**
 * Parsed validation step from MyInvois response
 */
interface ParsedValidationStep {
  status: string;
  name: string;
  errorCode?: string;
  errorMessage?: string;
  errorMessageMs?: string;
  propertyName?: string;
  propertyPath?: string;
}

/**
 * Parse validationResults.validationSteps array from MyInvois response
 * This is the actual structure returned by MyInvois API for document validation
 */
function parseValidationSteps(body: unknown): ParsedValidationStep | undefined {
  if (!body || typeof body !== "object") return undefined;

  const obj = body as Record<string, unknown>;

  // Look for validationResults.validationSteps structure
  let validationResults = obj.validationResults as Record<string, unknown> | undefined;

  // Also check for direct validationSteps at root level
  if (!validationResults && obj.validationSteps) {
    validationResults = obj as Record<string, unknown>;
  }

  if (!validationResults) return undefined;

  const steps = validationResults.validationSteps;
  if (!Array.isArray(steps)) return undefined;

  // Find the first Invalid step
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const stepObj = step as Record<string, unknown>;

    if (stepObj.status === "Invalid") {
      const result: ParsedValidationStep = {
        status: "Invalid",
        name: typeof stepObj.name === "string" ? stepObj.name : "",
      };

      // Extract error details
      const error = stepObj.error as Record<string, unknown> | undefined;
      if (error && typeof error === "object") {
        result.errorCode = typeof error.errorCode === "string" ? error.errorCode : undefined;
        result.propertyName = typeof error.propertyName === "string" ? error.propertyName : undefined;
        result.propertyPath = typeof error.propertyPath === "string" ? error.propertyPath : undefined;

        // Get message from error object
        if (typeof error.error === "string") {
          result.errorMessage = error.error;
        }
        if (typeof error.errorMs === "string") {
          result.errorMessageMs = error.errorMs;
        }

        // Check innerError for more detailed message (this is where the actual user-facing message is)
        const innerErrors = error.innerError;
        if (Array.isArray(innerErrors) && innerErrors.length > 0) {
          const firstInner = innerErrors[0] as Record<string, unknown>;
          if (firstInner && typeof firstInner === "object") {
            // Inner error has the actual human-readable message
            if (typeof firstInner.error === "string") {
              result.errorMessage = firstInner.error;
            }
            if (typeof firstInner.errorMs === "string") {
              result.errorMessageMs = firstInner.errorMs;
            }
            // Inner error may have more specific property info
            if (typeof firstInner.propertyName === "string" && !result.propertyName) {
              result.propertyName = firstInner.propertyName;
            }
            if (typeof firstInner.propertyPath === "string" && !result.propertyPath) {
              result.propertyPath = firstInner.propertyPath;
            }
            if (typeof firstInner.errorCode === "string" && !result.errorCode) {
              result.errorCode = firstInner.errorCode;
            }
          }
        }
      }

      return result;
    }
  }

  return undefined;
}

/**
 * Extract error message from various body formats
 */
function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;

  const obj = body as Record<string, unknown>;

  // First, try to get message from validationSteps (real MyInvois structure)
  const parsedStep = parseValidationSteps(body);
  if (parsedStep?.errorMessage) {
    return parsedStep.errorMessage;
  }

  // Standard patterns - prefer full message over error codes
  if (typeof obj.message === "string") return obj.message;
  // OAuth error_description has the human-readable message (error is just the code)
  if (typeof obj.error_description === "string") return obj.error_description;
  // error field might be a code like "invalid_client" or a full message
  if (typeof obj.error === "string" && obj.error.length > 30) return obj.error;

  // MyInvois specific patterns
  if (typeof obj.Message === "string") return obj.Message;
  if (typeof obj.ErrorMessage === "string") return obj.ErrorMessage;

  // Nested error object
  if (obj.error && typeof obj.error === "object") {
    const errorObj = obj.error as Record<string, unknown>;
    if (typeof errorObj.message === "string") return errorObj.message;
  }

  // Fallback to short error field (could be an error code)
  if (typeof obj.error === "string") return obj.error;

  return undefined;
}

/**
 * Extract error code from various body formats
 */
function extractErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;

  // First, try to get from validationSteps (real MyInvois structure)
  const parsedStep = parseValidationSteps(body);
  if (parsedStep?.errorCode) {
    return parsedStep.errorCode;
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.code === "string") return obj.code;
  if (typeof obj.Code === "string") return obj.Code;
  if (typeof obj.error === "string") return obj.error;
  if (typeof obj.errorCode === "string") return obj.errorCode;
  if (typeof obj.ErrorCode === "string") return obj.ErrorCode;

  return undefined;
}

/**
 * Extract step name from various body formats
 */
function extractStepName(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;

  // First, try to get from validationSteps (real MyInvois structure)
  const parsedStep = parseValidationSteps(body);
  if (parsedStep?.name) {
    return parsedStep.name;
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.stepName === "string") return obj.stepName;
  if (typeof obj.StepName === "string") return obj.StepName;
  if (typeof obj.validationStep === "string") return obj.validationStep;
  if (typeof obj.ValidationStep === "string") return obj.ValidationStep;

  // Sometimes the step is embedded in the message
  const message = extractErrorMessage(body);
  if (message) {
    // Look for "Step05-..." pattern
    const stepMatch = message.match(/Step\d+[-\s]*([^:]+)/i);
    if (stepMatch) return stepMatch[0];
  }

  return undefined;
}

/**
 * Extract property path from body (for validation errors)
 */
function extractPropertyPath(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;

  // First, try to get from validationSteps (real MyInvois structure)
  const parsedStep = parseValidationSteps(body);
  if (parsedStep?.propertyPath) {
    return parsedStep.propertyPath;
  }

  const obj = body as Record<string, unknown>;
  if (typeof obj.propertyPath === "string") return obj.propertyPath;
  if (typeof obj.PropertyPath === "string") return obj.PropertyPath;

  return undefined;
}

/**
 * Extract property name (field) from body
 */
function extractPropertyName(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;

  // First, try to get from validationSteps (real MyInvois structure)
  const parsedStep = parseValidationSteps(body);
  if (parsedStep?.propertyName) {
    return parsedStep.propertyName;
  }

  const obj = body as Record<string, unknown>;
  if (typeof obj.propertyName === "string") return obj.propertyName;
  if (typeof obj.PropertyName === "string") return obj.PropertyName;
  if (typeof obj.field === "string") return obj.field;

  return undefined;
}

/**
 * Extract all searchable text from body for pattern matching
 */
function extractAllSearchableText(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];

  const obj = body as Record<string, unknown>;
  const texts: string[] = [];

  // Standard fields
  if (typeof obj.message === "string") texts.push(obj.message);
  if (typeof obj.error === "string") texts.push(obj.error);
  if (typeof obj.error_description === "string") texts.push(obj.error_description);
  if (typeof obj.code === "string") texts.push(obj.code);

  // PascalCase variants
  if (typeof obj.Message === "string") texts.push(obj.Message);
  if (typeof obj.ErrorMessage === "string") texts.push(obj.ErrorMessage);

  return texts;
}

/**
 * Match error against known patterns
 */
function matchErrorPattern(
  input: MyInvoisErrorInput,
  message: string
): ErrorPattern | undefined {
  const searchText = [
    input.stepName,
    extractStepName(input.body),
    message,
    input.errorCode,
    ...extractAllSearchableText(input.body),
  ]
    .filter(Boolean)
    .join(" ");

  // Check validation step patterns
  for (const pattern of VALIDATION_STEP_PATTERNS) {
    if (typeof pattern.pattern === "string") {
      if (searchText.toLowerCase().includes(pattern.pattern.toLowerCase())) {
        return pattern;
      }
    } else if (pattern.pattern.test(searchText)) {
      return pattern;
    }
  }

  // Check auth patterns for 401/400 errors
  if (input.httpStatus === 401 || input.httpStatus === 400) {
    for (const pattern of AUTH_ERROR_PATTERNS) {
      if (typeof pattern.pattern === "string") {
        if (searchText.toLowerCase().includes(pattern.pattern.toLowerCase())) {
          return pattern;
        }
      } else if (pattern.pattern.test(searchText)) {
        return pattern;
      }
    }
  }

  return undefined;
}

/**
 * Normalize a MyInvois error into the unified ErrorEnvelope format.
 *
 * This is the central normalization function that should be used for all
 * upstream errors from the MyInvois API.
 *
 * @param input - Raw error input from MyInvois
 * @returns Normalized error envelope
 */
export function normalizeMyinvoisError(input: MyInvoisErrorInput): ErrorEnvelope {
  const { httpStatus, body, path, method, correlationId } = input;

  // Extract message and code from body
  const rawMessage = extractErrorMessage(body);
  const rawCode = input.errorCode || extractErrorCode(body);
  const stepName = input.stepName || extractStepName(body);

  // Build upstream context
  const upstream: UpstreamErrorContext = {
    source: "MYINVOIS",
    status: httpStatus,
    errorCode: rawCode,
    errorName: stepName,
    path,
    method,
  };

  // Handle timeout (status 0 with timeout indication)
  if (httpStatus === 0 || httpStatus === 408) {
    return createErrorEnvelope(
      ErrorCodes.UPSTREAM_TIMEOUT,
      "Request to MyInvois timed out. Please try again.",
      504,
      {
        retryable: true,
        upstream,
        correlationId,
      }
    );
  }

  // Handle rate limiting (429)
  if (httpStatus === 429) {
    return createErrorEnvelope(
      ErrorCodes.UPSTREAM_RATE_LIMITED,
      "MyInvois rate limit exceeded. Please wait before retrying.",
      429,
      {
        retryable: true,
        upstream,
        correlationId,
        retryAfterSeconds: extractRetryAfter(body),
      }
    );
  }

  // Handle server errors (5xx)
  if (httpStatus >= 500) {
    return createErrorEnvelope(
      ErrorCodes.UPSTREAM_ERROR,
      rawMessage || "MyInvois service is temporarily unavailable.",
      502,
      {
        retryable: true,
        upstream,
        correlationId,
      }
    );
  }

  // Try to match against known patterns
  const matchedPattern = matchErrorPattern(input, rawMessage || "");
  if (matchedPattern) {
    // Extract field and propertyPath from body
    const field = matchedPattern.extractField?.(body, rawMessage || "") || extractPropertyName(body);
    const propertyPath = extractPropertyPath(body);

    // Use the actual error message from MyInvois if available, otherwise use template
    const message = rawMessage || matchedPattern.messageTemplate;

    return createErrorEnvelope(
      matchedPattern.code,
      message,
      matchedPattern.httpStatus,
      {
        retryable: matchedPattern.retryable,
        upstream,
        field,
        propertyPath,
        correlationId,
      }
    );
  }

  // Handle 404
  if (httpStatus === 404) {
    return createErrorEnvelope(
      ErrorCodes.NOT_FOUND,
      rawMessage || "The requested resource was not found.",
      404,
      {
        retryable: false,
        upstream,
        correlationId,
      }
    );
  }

  // Handle 403
  if (httpStatus === 403) {
    return createErrorEnvelope(
      ErrorCodes.FORBIDDEN,
      rawMessage || "Access denied. You do not have permission to perform this action.",
      403,
      {
        retryable: false,
        upstream,
        correlationId,
      }
    );
  }

  // Handle 401 (generic, not matched by auth patterns)
  if (httpStatus === 401) {
    return createErrorEnvelope(
      ErrorCodes.AUTH_UNAVAILABLE,
      rawMessage || "Authentication failed. Please check your credentials.",
      401,
      {
        retryable: true,
        upstream,
        correlationId,
      }
    );
  }

  // Handle 400-level errors (generic validation)
  if (httpStatus >= 400 && httpStatus < 500) {
    return createErrorEnvelope(
      ErrorCodes.DOCUMENT_VALIDATION_FAILED,
      rawMessage || "Document validation failed. Please check your submission.",
      400,
      {
        retryable: false,
        upstream,
        correlationId,
      }
    );
  }

  // Fallback for unknown errors
  return createErrorEnvelope(
    ErrorCodes.INTERNAL_ERROR,
    rawMessage || "An unexpected error occurred.",
    500,
    {
      retryable: false,
      upstream,
      correlationId,
    }
  );
}

/**
 * Extract retry-after seconds from response body
 */
function extractRetryAfter(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;

  const obj = body as Record<string, unknown>;

  if (typeof obj.retryAfter === "number") return obj.retryAfter;
  if (typeof obj.retryAfterSeconds === "number") return obj.retryAfterSeconds;
  if (typeof obj.retry_after === "number") return obj.retry_after;

  return undefined;
}

/**
 * Normalize a network/timeout error
 */
export function normalizeNetworkError(
  error: Error,
  context?: { path?: string; method?: string; correlationId?: string }
): ErrorEnvelope {
  const isTimeout = error.name === "AbortError" || error.message.includes("timeout");

  if (isTimeout) {
    return createErrorEnvelope(
      ErrorCodes.UPSTREAM_TIMEOUT,
      "Request to MyInvois timed out. Please try again.",
      504,
      {
        retryable: true,
        correlationId: context?.correlationId,
        upstream: {
          source: "MYINVOIS",
          path: context?.path,
          method: context?.method,
        },
      }
    );
  }

  return createErrorEnvelope(
    ErrorCodes.NETWORK_ERROR,
    `Network error: ${error.message}`,
    503,
    {
      retryable: true,
      correlationId: context?.correlationId,
      upstream: {
        source: "MYINVOIS",
        path: context?.path,
        method: context?.method,
      },
    }
  );
}

/**
 * Create a local validation error (not from upstream)
 */
export function createLocalValidationError(
  code: string,
  message: string,
  options?: {
    httpStatus?: number;
    field?: string;
    propertyPath?: string;
    correlationId?: string;
  }
): ErrorEnvelope {
  return createErrorEnvelope(
    code,
    message,
    options?.httpStatus ?? 400,
    {
      retryable: false,
      field: options?.field,
      propertyPath: options?.propertyPath,
      correlationId: options?.correlationId,
      upstream: {
        source: "MIDDLEWARE",
      },
    }
  );
}

// Re-export types and utilities from core
export {
  type ErrorEnvelope,
  type UpstreamErrorContext,
  type ErrorEnvelopeResponse,
  type ErrorEnvelopeDetail,
  ErrorCodes,
  createErrorEnvelope,
  createErrorEnvelopeResponse,
  isRetryableError,
  getHttpStatusForCode,
} from "@myinvois/core";
