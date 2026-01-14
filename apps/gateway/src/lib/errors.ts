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

