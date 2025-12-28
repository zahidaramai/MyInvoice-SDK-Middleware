/**
 * Error Handler Plugin
 *
 * Unified error handling for the gateway. Converts all errors to the
 * standardized ErrorEnvelope format for consistent client experience.
 */

import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import {
  AppError,
  createErrorEnvelope,
  createNotFoundError,
  ErrorCodes,
  isRetryableError,
} from "../lib/errors.js";
import { createErrorEnvelopeResponse, type ErrorEnvelope } from "@myinvois/core";

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    const correlationId = request.correlationId || request.id;

    let envelope: { error: ErrorEnvelope };

    if (error instanceof AppError) {
      // Use the AppError's built-in conversion
      const errorEnvelope = error.toErrorEnvelope(correlationId);
      envelope = createErrorEnvelopeResponse(errorEnvelope);

      // Log based on status code
      if (error.statusCode >= 500) {
        request.log.error({ err: error, correlationId, code: error.code }, "Server error");
      } else {
        request.log.warn({ correlationId, code: error.code }, "Client error: %s", error.message);
      }

      // Add Retry-After header for rate limiting
      if (error.details?.retryAfterSeconds) {
        reply.header("Retry-After", String(error.details.retryAfterSeconds));
      }

      reply.header("X-Correlation-Id", correlationId);
      return reply.status(error.statusCode).send(envelope);
    }

    // Handle generic errors
    let statusCode = 500;
    let message = "Internal server error";
    let errorCode: string = ErrorCodes.INTERNAL_ERROR;
    let propertyPath: string | undefined;
    let retryable = false;

    if (error instanceof Error) {
      message = error.message;

      // Check for statusCode property (Fastify validation errors, etc.)
      const errorWithStatus = error as Error & {
        statusCode?: number;
        validation?: unknown;
      };

      if (typeof errorWithStatus.statusCode === "number") {
        statusCode = errorWithStatus.statusCode;

        // Map status codes to error codes
        switch (statusCode) {
          case 400:
            errorCode = ErrorCodes.BAD_REQUEST;
            break;
          case 401:
            errorCode = ErrorCodes.AUTH_UNAVAILABLE;
            retryable = true;
            break;
          case 403:
            errorCode = ErrorCodes.FORBIDDEN;
            break;
          case 404:
            errorCode = ErrorCodes.NOT_FOUND;
            break;
          case 409:
            errorCode = ErrorCodes.IDEMPOTENCY_CONFLICT;
            break;
          case 413:
            errorCode = ErrorCodes.PAYLOAD_TOO_LARGE;
            break;
          case 429:
            errorCode = ErrorCodes.UPSTREAM_RATE_LIMITED;
            retryable = true;
            break;
          default:
            if (statusCode >= 500) {
              errorCode = ErrorCodes.INTERNAL_ERROR;
              retryable = isRetryableError(errorCode);
            }
        }
      }

      // Check for Fastify validation errors
      if (errorWithStatus.validation) {
        errorCode = ErrorCodes.VALIDATION_ERROR;
        statusCode = 400;
      }
    }

    // Log the error
    if (statusCode >= 500) {
      request.log.error({ err: error, correlationId, code: errorCode }, "Server error");
    } else {
      request.log.warn({ correlationId, code: errorCode }, "Client error: %s", message);
    }

    envelope = createErrorEnvelope(statusCode, message, {
      correlationId,
      errorCode,
      propertyPath,
      retryable,
    });

    reply.header("X-Correlation-Id", correlationId);
    return reply.status(statusCode).send(envelope);
  });

  fastify.setNotFoundHandler((request, reply) => {
    const correlationId = request.correlationId || request.id;
    const envelope = createNotFoundError(
      `${request.method} ${request.url}`,
      correlationId
    );

    request.log.warn(
      { correlationId, path: request.url },
      "Route not found: %s %s",
      request.method,
      request.url
    );

    reply.header("X-Correlation-Id", correlationId);
    return reply.status(404).send(envelope);
  });
};

export const errorHandlerPlugin = fp(plugin, {
  name: "errorHandler",
  dependencies: ["correlationId"],
});
