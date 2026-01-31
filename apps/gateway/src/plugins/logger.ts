/**
 * Logger configuration for Fastify/Pino with redaction
 * Provides consistent structured JSON logging with sensitive data redaction
 */

import type { FastifyServerOptions } from "fastify";
import { PINO_REDACT_CONFIG, clientIdFingerprint } from "@myinvois/core";

/**
 * Create Pino logger options for Fastify
 */
export function createLoggerOptions(level: string = "info"): FastifyServerOptions["logger"] {
  return {
    level,
    redact: PINO_REDACT_CONFIG,
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          path: request.routeOptions?.url || request.url,
          correlationId: request.id,
          // Redact sensitive headers
          headers: {
            host: request.headers.host,
            "user-agent": request.headers["user-agent"],
            "content-type": request.headers["content-type"],
            "x-correlation-id": request.headers["x-correlation-id"],
            // Authorization and cookies are auto-redacted by Pino
          },
        };
      },
      res(reply) {
        return {
          statusCode: reply.statusCode,
          headers: {
            "x-correlation-id": reply.getHeader?.("x-correlation-id"),
            "x-cache": reply.getHeader?.("x-cache"),
            "retry-after": reply.getHeader?.("retry-after"),
          },
        };
      },
    },
    // Custom log message format
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    // Include timestamp
    timestamp: true,
  };
}

/**
 * Create log context for session operations
 * Safely includes session info without secrets
 */
export function createSessionLogContext(session: {
  sessionId: string;
  env: string;
  mode: string;
  clientId: string;
}): Record<string, string> {
  return {
    sessionId: session.sessionId,
    env: session.env,
    mode: session.mode,
    clientIdFingerprint: clientIdFingerprint(session.clientId),
  };
}

/**
 * Create log context for submission operations
 */
export function createSubmissionLogContext(submission: {
  trackingId: string;
  sessionId: string;
  submissionUid?: string;
}): Record<string, string | undefined> {
  return {
    trackingId: submission.trackingId,
    sessionId: submission.sessionId,
    submissionUid: submission.submissionUid,
  };
}

/**
 * Create log context for document operations
 */
export function createDocumentLogContext(doc: {
  documentUuid: string;
  sessionId: string;
  status?: string;
}): Record<string, string | undefined> {
  return {
    documentUuid: doc.documentUuid,
    sessionId: doc.sessionId,
    status: doc.status,
  };
}
