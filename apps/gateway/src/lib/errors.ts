/**
 * Gateway Error Handling
 *
 * This module provides error types and utilities for the gateway.
 * All errors are normalized to the unified ErrorEnvelope format from @myinvois/core.
 */

import {
  type ErrorEnvelope as CoreErrorEnvelope,
  type ErrorEnvelopeResponse,
  type UpstreamErrorContext,
  ErrorCodes,
  createErrorEnvelope as coreCreateErrorEnvelope,
  createErrorEnvelopeResponse,
  isRetryableError,
} from "@myinvois/core";

// Re-export core types and utilities
export {
  type ErrorEnvelope,
  type ErrorEnvelopeResponse,
  type UpstreamErrorContext,
  ErrorCodes,
  isRetryableError,
  getHttpStatusForCode,
} from "@myinvois/core";

// Re-export normalizer from myinvois-client
export {
  normalizeMyinvoisError,
  normalizeNetworkError,
  createLocalValidationError,
  type MyInvoisErrorInput,
} from "@myinvois/myinvois-client";

/**
 * Legacy GatewayError interface - kept for backward compatibility
 * @deprecated Use ErrorEnvelope from @myinvois/core instead
 */
export interface GatewayError {
  correlationId?: string;
  httpStatus: number;
  errorCode?: string;
  propertyName?: string | null;
  propertyPath?: string | null;
  target?: string | null;
  messageEN: string;
  messageMS?: string;
  inner?: GatewayError[];
  retryAfterSeconds?: number;
  upstream?: { service: "MYINVOIS"; path: string; method?: string; status?: number };
}

/**
 * Legacy ErrorEnvelope - kept for backward compatibility during transition
 * @deprecated Use ErrorEnvelopeResponse from @myinvois/core instead
 */
export interface LegacyErrorEnvelope {
  error: GatewayError;
}

/**
 * Application Error class for throwing structured errors
 *
 * Use this class to throw errors that will be automatically converted
 * to the unified ErrorEnvelope format by the error handler plugin.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details?: {
    propertyPath?: string;
    field?: string;
    correlationId?: string;
    upstream?: UpstreamErrorContext;
    retryAfterSeconds?: number;
    trackingId?: string;
  };

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    details?: {
      propertyPath?: string;
      field?: string;
      correlationId?: string;
      upstream?: UpstreamErrorContext;
      retryAfterSeconds?: number;
      trackingId?: string;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code || ErrorCodes.INTERNAL_ERROR;
    this.retryable = details?.retryable ?? isRetryableError(this.code);
    this.details = details;
  }

  /**
   * Convert AppError to ErrorEnvelope
   */
  toErrorEnvelope(correlationId?: string): CoreErrorEnvelope {
    return coreCreateErrorEnvelope(
      this.code,
      this.message,
      this.statusCode,
      {
        retryable: this.retryable,
        correlationId: this.details?.correlationId || correlationId,
        propertyPath: this.details?.propertyPath,
        field: this.details?.field,
        upstream: this.details?.upstream,
        retryAfterSeconds: this.details?.retryAfterSeconds,
        trackingId: this.details?.trackingId,
      }
    );
  }
}

/**
 * Create an error envelope response
 *
 * This function creates the standardized error response format.
 * All 4xx/5xx responses should use this format.
 */
export function createErrorEnvelope(
  httpStatus: number,
  messageEN: string,
  options: {
    correlationId?: string;
    errorCode?: string;
    propertyPath?: string;
    retryAfterSeconds?: number;
    retryable?: boolean;
    upstream?: UpstreamErrorContext;
  } = {}
): ErrorEnvelopeResponse {
  const code = options.errorCode || ErrorCodes.INTERNAL_ERROR;
  const envelope = coreCreateErrorEnvelope(
    code,
    messageEN,
    httpStatus,
    {
      retryable: options.retryable ?? isRetryableError(code),
      correlationId: options.correlationId,
      propertyPath: options.propertyPath,
      retryAfterSeconds: options.retryAfterSeconds,
      upstream: options.upstream,
    }
  );
  return createErrorEnvelopeResponse(envelope);
}

/**
 * Create a 404 Not Found error
 */
export function createNotFoundError(
  path: string,
  correlationId?: string
): ErrorEnvelopeResponse {
  return createErrorEnvelope(404, `Route ${path} not found`, {
    correlationId,
    errorCode: ErrorCodes.NOT_FOUND,
    retryable: false,
  });
}

/**
 * Create a 501 Not Implemented error
 */
export function createNotImplementedError(
  correlationId?: string
): ErrorEnvelopeResponse {
  return createErrorEnvelope(
    501,
    "This feature is not implemented yet.",
    {
      correlationId,
      errorCode: "NOT_IMPLEMENTED",
      retryable: false,
    }
  );
}

/**
 * Create a validation error (400)
 */
export function createValidationError(
  message: string,
  options?: {
    correlationId?: string;
    propertyPath?: string;
    code?: string;
  }
): ErrorEnvelopeResponse {
  return createErrorEnvelope(400, message, {
    correlationId: options?.correlationId,
    errorCode: options?.code || ErrorCodes.VALIDATION_ERROR,
    propertyPath: options?.propertyPath,
    retryable: false,
  });
}

/**
 * Create a payload too large error (413)
 */
export function createPayloadTooLargeError(
  message: string,
  correlationId?: string
): ErrorEnvelopeResponse {
  return createErrorEnvelope(413, message, {
    correlationId,
    errorCode: ErrorCodes.PAYLOAD_TOO_LARGE,
    retryable: false,
  });
}

/**
 * Create an idempotency conflict error (409)
 */
export function createIdempotencyConflictError(
  message: string,
  correlationId?: string
): ErrorEnvelopeResponse {
  return createErrorEnvelope(409, message, {
    correlationId,
    errorCode: ErrorCodes.IDEMPOTENCY_CONFLICT,
    retryable: false,
  });
}

/**
 * Create a rate limit error (429)
 */
export function createRateLimitError(
  message: string,
  retryAfterSeconds: number,
  options?: {
    correlationId?: string;
    upstream?: UpstreamErrorContext;
  }
): ErrorEnvelopeResponse {
  return createErrorEnvelope(429, message, {
    correlationId: options?.correlationId,
    errorCode: ErrorCodes.UPSTREAM_RATE_LIMITED,
    retryAfterSeconds,
    retryable: true,
    upstream: options?.upstream,
  });
}

/**
 * Create an upstream error (502/503/504)
 */
export function createUpstreamError(
  httpStatus: 502 | 503 | 504,
  message: string,
  options?: {
    correlationId?: string;
    upstream?: UpstreamErrorContext;
    retryable?: boolean;
  }
): ErrorEnvelopeResponse {
  const codeMap: Record<number, string> = {
    502: ErrorCodes.UPSTREAM_ERROR,
    503: ErrorCodes.NETWORK_ERROR,
    504: ErrorCodes.UPSTREAM_TIMEOUT,
  };
  return createErrorEnvelope(httpStatus, message, {
    correlationId: options?.correlationId,
    errorCode: codeMap[httpStatus],
    retryable: options?.retryable ?? true,
    upstream: options?.upstream,
  });
}
