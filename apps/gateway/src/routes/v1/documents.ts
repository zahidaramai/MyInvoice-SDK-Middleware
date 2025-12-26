/**
 * Documents routes - Document state changes and details
 */

import type { FastifyPluginAsync } from "fastify";
import { AppError, createErrorEnvelope } from "../../lib/errors.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { getTokenManager, getRateLimiter } from "../../lib/myinvois.js";
import {
  changeDocumentState,
  getDocumentDetails,
} from "@myinvois/myinvois-client";
import {
  recordDocumentAction,
  recordDocumentActionError,
  recordDocumentDetails,
} from "@myinvois/storage";

/**
 * Request body for cancel/reject endpoints
 */
interface DocumentStateChangeBody {
  sessionId: string;
  reason: string;
}

/**
 * Validate session ID format
 */
function isValidSessionId(id: string): boolean {
  return /^sess_[a-zA-Z0-9]+$/.test(id);
}

/**
 * Validate UUID format
 */
function isValidUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

export const documentsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/documents/:uuid/cancel - Cancel a document
   */
  fastify.post<{ Params: { uuid: string }; Body: DocumentStateChangeBody }>(
    "/v1/documents/:uuid/cancel",
    async (request, reply) => {
      const correlationId = request.correlationId || request.id;
      const { uuid } = request.params;
      const { body } = request;

      // Validate UUID format
      if (!isValidUuid(uuid)) {
        throw new AppError(400, "Invalid UUID format", "INVALID_UUID", {
          propertyPath: "uuid",
        });
      }

      // Validate sessionId format
      if (!body.sessionId || !isValidSessionId(body.sessionId)) {
        throw new AppError(400, "Invalid sessionId format", "INVALID_SESSION_ID", {
          propertyPath: "sessionId",
        });
      }

      // Validate reason
      if (!body.reason || body.reason.trim().length === 0) {
        throw new AppError(400, "Reason is required", "MISSING_REASON", {
          propertyPath: "reason",
        });
      }

      if (body.reason.length > 500) {
        throw new AppError(400, "Reason must be 500 characters or less", "REASON_TOO_LONG", {
          propertyPath: "reason",
        });
      }

      // Get session
      const session = sessionStore.get(body.sessionId);
      if (!session) {
        throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
      }

      // Call upstream MyInvois API
      const tokenManager = getTokenManager();
      const rateLimiter = getRateLimiter();

      const result = await changeDocumentState(
        {
          sessionId: session.sessionId,
          env: session.env,
          mode: session.mode,
          clientId: session.clientId,
          clientSecret: session.clientSecret,
          scope: session.scope,
          onBehalfOf: session.onBehalfOf,
        },
        {
          uuid,
          status: "cancelled",
          reason: body.reason,
        },
        { tokenManager, rateLimiter }
      );

      if (!result.ok) {
        // Record error in database if document exists locally
        await recordDocumentActionError({
          uuid,
          actionType: "CANCEL",
          reason: body.reason,
          errorCode: result.error.code || "UPSTREAM_ERROR",
          errorMessage: result.error.message,
        }).catch(() => {
          // Ignore errors recording to non-existent documents
        });

        // Handle rate limit
        if (result.error.status === 429 || result.error.code === "UPSTREAM_RATE_LIMIT") {
          const retryAfter = result.error.meta?.rateLimitReset
            ? result.error.meta.rateLimitReset - Math.floor(Date.now() / 1000)
            : 60;

          const envelope = createErrorEnvelope(429, result.error.message, {
            correlationId: result.error.meta?.correlationId || correlationId,
            errorCode: result.error.code || "RATE_LIMIT_EXCEEDED",
            retryAfterSeconds: retryAfter,
          });

          reply.header("X-Correlation-Id", result.error.meta?.correlationId || correlationId);
          reply.header("Retry-After", String(retryAfter));
          return reply.status(429).send(envelope);
        }

        // Handle not found
        if (result.error.status === 404) {
          throw new AppError(404, "Document not found", "DOCUMENT_NOT_FOUND");
        }

        // Handle forbidden (not owner)
        if (result.error.status === 403) {
          throw new AppError(403, result.error.message, "FORBIDDEN");
        }

        // Handle validation error
        if (result.error.status === 400) {
          throw new AppError(400, result.error.message, result.error.code || "VALIDATION_ERROR");
        }

        // Generic upstream error
        throw new AppError(
          result.error.status || 500,
          result.error.message,
          result.error.code || "UPSTREAM_ERROR",
          {
            correlationId: result.error.meta?.correlationId,
          }
        );
      }

      // Record success in database if document exists locally
      await recordDocumentAction({
        uuid,
        actionType: "CANCEL",
        reason: body.reason,
        upstreamStatus: result.result.status,
        correlationId: result.result.meta.correlationId,
      }).catch(() => {
        // Ignore errors recording to non-existent documents
      });

      request.log.info(
        {
          correlationId: result.result.meta.correlationId || correlationId,
          uuid,
          status: result.result.status,
        },
        "Document cancelled"
      );

      reply.header("X-Correlation-Id", result.result.meta.correlationId || correlationId);
      return reply.status(200).send({
        uuid: result.result.uuid,
        status: result.result.status,
      });
    }
  );

  /**
   * POST /v1/documents/:uuid/reject - Reject a document
   */
  fastify.post<{ Params: { uuid: string }; Body: DocumentStateChangeBody }>(
    "/v1/documents/:uuid/reject",
    async (request, reply) => {
      const correlationId = request.correlationId || request.id;
      const { uuid } = request.params;
      const { body } = request;

      // Validate UUID format
      if (!isValidUuid(uuid)) {
        throw new AppError(400, "Invalid UUID format", "INVALID_UUID", {
          propertyPath: "uuid",
        });
      }

      // Validate sessionId format
      if (!body.sessionId || !isValidSessionId(body.sessionId)) {
        throw new AppError(400, "Invalid sessionId format", "INVALID_SESSION_ID", {
          propertyPath: "sessionId",
        });
      }

      // Validate reason
      if (!body.reason || body.reason.trim().length === 0) {
        throw new AppError(400, "Reason is required", "MISSING_REASON", {
          propertyPath: "reason",
        });
      }

      if (body.reason.length > 500) {
        throw new AppError(400, "Reason must be 500 characters or less", "REASON_TOO_LONG", {
          propertyPath: "reason",
        });
      }

      // Get session
      const session = sessionStore.get(body.sessionId);
      if (!session) {
        throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
      }

      // Call upstream MyInvois API
      const tokenManager = getTokenManager();
      const rateLimiter = getRateLimiter();

      const result = await changeDocumentState(
        {
          sessionId: session.sessionId,
          env: session.env,
          mode: session.mode,
          clientId: session.clientId,
          clientSecret: session.clientSecret,
          scope: session.scope,
          onBehalfOf: session.onBehalfOf,
        },
        {
          uuid,
          status: "rejected",
          reason: body.reason,
        },
        { tokenManager, rateLimiter }
      );

      if (!result.ok) {
        // Record error in database if document exists locally
        await recordDocumentActionError({
          uuid,
          actionType: "REJECT",
          reason: body.reason,
          errorCode: result.error.code || "UPSTREAM_ERROR",
          errorMessage: result.error.message,
        }).catch(() => {
          // Ignore errors recording to non-existent documents
        });

        // Handle rate limit
        if (result.error.status === 429 || result.error.code === "UPSTREAM_RATE_LIMIT") {
          const retryAfter = result.error.meta?.rateLimitReset
            ? result.error.meta.rateLimitReset - Math.floor(Date.now() / 1000)
            : 60;

          const envelope = createErrorEnvelope(429, result.error.message, {
            correlationId: result.error.meta?.correlationId || correlationId,
            errorCode: result.error.code || "RATE_LIMIT_EXCEEDED",
            retryAfterSeconds: retryAfter,
          });

          reply.header("X-Correlation-Id", result.error.meta?.correlationId || correlationId);
          reply.header("Retry-After", String(retryAfter));
          return reply.status(429).send(envelope);
        }

        // Handle not found
        if (result.error.status === 404) {
          throw new AppError(404, "Document not found", "DOCUMENT_NOT_FOUND");
        }

        // Handle forbidden (not recipient)
        if (result.error.status === 403) {
          throw new AppError(403, result.error.message, "FORBIDDEN");
        }

        // Handle validation error
        if (result.error.status === 400) {
          throw new AppError(400, result.error.message, result.error.code || "VALIDATION_ERROR");
        }

        // Generic upstream error
        throw new AppError(
          result.error.status || 500,
          result.error.message,
          result.error.code || "UPSTREAM_ERROR",
          {
            correlationId: result.error.meta?.correlationId,
          }
        );
      }

      // Record success in database if document exists locally
      await recordDocumentAction({
        uuid,
        actionType: "REJECT",
        reason: body.reason,
        upstreamStatus: result.result.status,
        correlationId: result.result.meta.correlationId,
      }).catch(() => {
        // Ignore errors recording to non-existent documents
      });

      request.log.info(
        {
          correlationId: result.result.meta.correlationId || correlationId,
          uuid,
          status: result.result.status,
        },
        "Document rejected"
      );

      reply.header("X-Correlation-Id", result.result.meta.correlationId || correlationId);
      return reply.status(200).send({
        uuid: result.result.uuid,
        status: result.result.status,
      });
    }
  );

  /**
   * GET /v1/documents/:uuid/details - Get document details
   */
  fastify.get<{ Params: { uuid: string }; Querystring: { sessionId: string } }>(
    "/v1/documents/:uuid/details",
    async (request, reply) => {
      const correlationId = request.correlationId || request.id;
      const { uuid } = request.params;
      const { sessionId } = request.query;

      // Validate UUID format
      if (!isValidUuid(uuid)) {
        throw new AppError(400, "Invalid UUID format", "INVALID_UUID", {
          propertyPath: "uuid",
        });
      }

      // Validate sessionId format
      if (!sessionId || !isValidSessionId(sessionId)) {
        throw new AppError(400, "Invalid sessionId format", "INVALID_SESSION_ID", {
          propertyPath: "sessionId",
        });
      }

      // Get session
      const session = sessionStore.get(sessionId);
      if (!session) {
        throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
      }

      // Call upstream MyInvois API
      const tokenManager = getTokenManager();
      const rateLimiter = getRateLimiter();

      const result = await getDocumentDetails(
        {
          sessionId: session.sessionId,
          env: session.env,
          mode: session.mode,
          clientId: session.clientId,
          clientSecret: session.clientSecret,
          scope: session.scope,
          onBehalfOf: session.onBehalfOf,
        },
        { uuid },
        { tokenManager, rateLimiter }
      );

      if (!result.ok) {
        // Handle rate limit
        if (result.error.status === 429 || result.error.code === "UPSTREAM_RATE_LIMIT") {
          const retryAfter = result.error.meta?.rateLimitReset
            ? result.error.meta.rateLimitReset - Math.floor(Date.now() / 1000)
            : 60;

          const envelope = createErrorEnvelope(429, result.error.message, {
            correlationId: result.error.meta?.correlationId || correlationId,
            errorCode: result.error.code || "RATE_LIMIT_EXCEEDED",
            retryAfterSeconds: retryAfter,
          });

          reply.header("X-Correlation-Id", result.error.meta?.correlationId || correlationId);
          reply.header("Retry-After", String(retryAfter));
          return reply.status(429).send(envelope);
        }

        // Handle not found
        if (result.error.status === 404) {
          throw new AppError(404, "Document not found", "DOCUMENT_NOT_FOUND");
        }

        // Generic upstream error
        throw new AppError(
          result.error.status || 500,
          result.error.message,
          result.error.code || "UPSTREAM_ERROR",
          {
            correlationId: result.error.meta?.correlationId,
          }
        );
      }

      // Record details in database if document exists locally
      await recordDocumentDetails({
        uuid,
        status: result.result.status,
        longId: result.result.longId || undefined,
        dateTimeValidated: result.result.dateTimeValidated || undefined,
        dateTimeIssued: result.result.dateTimeIssued || undefined,
        dateTimeReceived: result.result.dateTimeReceived || undefined,
        cancelDateTime: result.result.cancelDateTime || undefined,
        rejectDateTime: result.result.rejectDateTime || undefined,
        issuerTin: result.result.issuerTin,
        issuerName: result.result.issuerName || undefined,
        receiverId: result.result.receiverId || undefined,
        receiverName: result.result.receiverName || undefined,
        totalPayableAmount: result.result.totalPayableAmount || undefined,
        statusReason: result.result.statusReason || undefined,
        correlationId: result.result.meta.correlationId,
      }).catch(() => {
        // Ignore errors recording to non-existent documents
      });

      request.log.info(
        {
          correlationId: result.result.meta.correlationId || correlationId,
          uuid,
          status: result.result.status,
        },
        "Document details retrieved"
      );

      reply.header("X-Correlation-Id", result.result.meta.correlationId || correlationId);
      return reply.status(200).send({
        uuid: result.result.uuid,
        longId: result.result.longId,
        internalId: result.result.internalId,
        status: result.result.status,
        dateTimeIssued: result.result.dateTimeIssued?.toISOString() || null,
        dateTimeReceived: result.result.dateTimeReceived?.toISOString() || null,
        dateTimeValidated: result.result.dateTimeValidated?.toISOString() || null,
        // Note: validationErrors would come from a separate API call or be included in status details
      });
    }
  );
};
