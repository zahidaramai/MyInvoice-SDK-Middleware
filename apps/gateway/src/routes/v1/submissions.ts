/**
 * Submissions routes - POST /v1/submissions
 */

import type { FastifyPluginAsync } from "fastify";
import { AppError, createErrorEnvelope } from "../../lib/errors.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { getTokenManager, getRateLimiter } from "../../lib/myinvois.js";
import {
  prepareDocument,
  validateSubmissionConstraints,
  computePayloadHash,
  generateTrackingId,
  type GatewayDocumentInput,
  type PreparedDocument,
} from "../../lib/submission.js";
import {
  submitDocuments,
  type SubmitDocumentsRequest,
} from "@myinvois/myinvois-client";
import {
  createSubmission,
  findRecentByPayloadHash,
  updateWithUpstreamResult,
  markSubmissionError,
  getByTrackingId,
  getByTrackingIdWithPolling,
  schedulePoll,
  type SubmissionWithDocuments,
} from "@myinvois/storage";
import type { StorageEnvironment } from "@myinvois/storage";
import { enqueuePoll, enqueueImmediatePoll, calculatePollDelay, MIN_POLL_INTERVAL_MS } from "../../lib/pollQueue.js";

/**
 * Request body for POST /v1/submissions
 */
interface CreateSubmissionBody {
  sessionId: string;
  documents: GatewayDocumentInput[];
  autoMinify?: boolean;
  asyncPolling?: boolean;
}

/**
 * Response for submission result
 */
interface SubmissionResultResponse {
  trackingId: string;
  submissionUid: string;
  acceptedDocuments: Array<{
    codeNumber: string;
    uuid: string;
  }>;
  rejectedDocuments: Array<{
    codeNumber: string;
    error: {
      httpStatus: number;
      messageEN: string;
      errorCode?: string;
    };
  }>;
}

/**
 * Validate session ID format
 */
function isValidSessionId(id: string): boolean {
  return /^sess_[a-zA-Z0-9]+$/.test(id);
}

/**
 * Convert database submission to response format
 */
function submissionToResponse(
  submission: SubmissionWithDocuments
): SubmissionResultResponse {
  const acceptedDocuments = submission.documents
    .filter((d) => d.initialResult === "ACCEPTED" && d.upstreamUuid)
    .map((d) => ({
      codeNumber: d.codeNumber,
      uuid: d.upstreamUuid!,
    }));

  const rejectedDocuments = submission.documents
    .filter((d) => d.initialResult === "REJECTED")
    .map((d) => ({
      codeNumber: d.codeNumber,
      error: {
        httpStatus: 400,
        messageEN: d.errorMessage || "Document rejected",
        errorCode: d.errorCode || undefined,
      },
    }));

  return {
    trackingId: submission.trackingId,
    submissionUid: submission.upstreamSubmissionUid || "",
    acceptedDocuments,
    rejectedDocuments,
  };
}

export const submissionsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/submissions - Submit documents
   */
  fastify.post<{ Body: CreateSubmissionBody }>(
    "/v1/submissions",
    async (request, reply) => {
      const correlationId = request.correlationId || request.id;
      const { body } = request;

      // Validate sessionId format
      if (!body.sessionId || !isValidSessionId(body.sessionId)) {
        throw new AppError(400, "Invalid sessionId format", "INVALID_SESSION_ID", {
          propertyPath: "sessionId",
        });
      }

      // Get session
      const session = sessionStore.get(body.sessionId);
      if (!session) {
        throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
      }

      // Validate documents array
      if (!Array.isArray(body.documents) || body.documents.length === 0) {
        throw new AppError(400, "At least one document is required", "NO_DOCUMENTS", {
          propertyPath: "documents",
        });
      }

      // Prepare documents (encode if needed, compute hashes)
      let preparedDocs: PreparedDocument[];
      try {
        preparedDocs = body.documents.map((doc, index) => {
          try {
            return prepareDocument(doc);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Invalid document";
            throw new AppError(400, message, "INVALID_DOCUMENT", {
              propertyPath: `documents[${index}]`,
            });
          }
        });
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(400, "Failed to prepare documents", "DOCUMENT_PREPARATION_FAILED");
      }

      // Validate submission constraints (size, count)
      const validationErrors = validateSubmissionConstraints(preparedDocs);
      if (validationErrors.length > 0) {
        const firstError = validationErrors[0];
        throw new AppError(400, firstError.message, firstError.code, {
          propertyPath: firstError.propertyPath,
        });
      }

      // Compute payload hash for deduplication
      const payloadHash = computePayloadHash(preparedDocs);

      // Check for recent duplicate submission
      const existingSubmission = await findRecentByPayloadHash(
        session.sessionId,
        payloadHash
      );

      if (existingSubmission) {
        // Return the cached result
        request.log.info(
          { correlationId, trackingId: existingSubmission.trackingId },
          "Duplicate submission detected, returning cached result"
        );

        const response = submissionToResponse(existingSubmission);
        reply.header("X-Correlation-Id", correlationId);
        return reply.status(202).send(response);
      }

      // Generate tracking ID
      const trackingId = generateTrackingId();

      // Create submission record
      await createSubmission({
        trackingId,
        sessionId: session.sessionId,
        env: session.env as StorageEnvironment,
        payloadHash,
        documents: preparedDocs.map((doc) => ({ codeNumber: doc.codeNumber })),
      });

      // Prepare upstream request
      const upstreamRequest: SubmitDocumentsRequest = {
        documents: preparedDocs.map((doc) => ({
          format: doc.format,
          document: doc.document,
          documentHash: doc.documentHash,
          codeNumber: doc.codeNumber,
        })),
      };

      // Call upstream MyInvois API
      const tokenManager = getTokenManager();
      const rateLimiter = getRateLimiter();

      const result = await submitDocuments(
        {
          sessionId: session.sessionId,
          env: session.env,
          mode: session.mode,
          clientId: session.clientId,
          clientSecret: session.clientSecret,
          scope: session.scope,
          onBehalfOf: session.onBehalfOf,
        },
        upstreamRequest,
        { tokenManager, rateLimiter }
      );

      if (!result.ok) {
        // Store error in database
        await markSubmissionError({
          trackingId,
          errorCode: result.error.code || "UPSTREAM_ERROR",
          errorMessage: result.error.message,
          correlationId: result.error.meta?.correlationId,
          retryAfterSeconds: result.error.meta?.rateLimitReset
            ? result.error.meta.rateLimitReset - Math.floor(Date.now() / 1000)
            : undefined,
        });

        // Handle specific error codes
        if (result.error.code === "DUPLICATE_SUBMISSION") {
          const retryAfter = result.error.meta?.rateLimitReset
            ? result.error.meta.rateLimitReset - Math.floor(Date.now() / 1000)
            : 600; // Default 10 minutes

          const envelope = createErrorEnvelope(422, result.error.message, {
            correlationId: result.error.meta?.correlationId || correlationId,
            errorCode: "DUPLICATE_SUBMISSION",
            retryAfterSeconds: retryAfter,
          });

          reply.header("X-Correlation-Id", result.error.meta?.correlationId || correlationId);
          reply.header("Retry-After", String(retryAfter));
          return reply.status(422).send(envelope);
        }

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

      // Update submission with upstream result
      await updateWithUpstreamResult({
        trackingId,
        upstreamSubmissionUid: result.result.submissionUid,
        correlationId: result.result.meta.correlationId,
        acceptedDocuments: result.result.acceptedDocuments.map((d) => ({
          codeNumber: d.codeNumber,
          uuid: d.uuid,
        })),
        rejectedDocuments: result.result.rejectedDocuments.map((d) => ({
          codeNumber: d.codeNumber,
          errorCode: d.errorCode,
          errorMessage: d.errorMessage,
        })),
      });

      // Schedule first poll with 3-5 second delay
      const pollDelay = calculatePollDelay();
      const nextPollAt = new Date(Date.now() + pollDelay);

      await schedulePoll({
        trackingId,
        nextPollAt,
      });

      // Enqueue poll job (fire and forget, don't block response)
      enqueuePoll(trackingId, pollDelay).catch((err) => {
        request.log.warn({ trackingId, error: err }, "Failed to enqueue poll job");
      });

      // Build response
      const submission = await getByTrackingId(trackingId);
      if (!submission) {
        throw new AppError(500, "Failed to retrieve submission", "INTERNAL_ERROR");
      }

      const response = submissionToResponse(submission);

      request.log.info(
        {
          correlationId: result.result.meta.correlationId || correlationId,
          trackingId,
          submissionUid: result.result.submissionUid,
          acceptedCount: result.result.acceptedDocuments.length,
          rejectedCount: result.result.rejectedDocuments.length,
        },
        "Submission completed"
      );

      reply.header("X-Correlation-Id", result.result.meta.correlationId || correlationId);
      return reply.status(202).send(response);
    }
  );

  /**
   * GET /v1/submissions/:trackingId - Get submission status
   */
  fastify.get<{ Params: { trackingId: string } }>(
    "/v1/submissions/:trackingId",
    async (request, reply) => {
      const correlationId = request.correlationId || request.id;
      const { trackingId } = request.params;

      const submission = await getByTrackingIdWithPolling(trackingId);
      if (!submission) {
        throw new AppError(404, "Submission not found", "SUBMISSION_NOT_FOUND");
      }

      // Build status response with polling fields
      const documents = submission.documents.map((doc) => ({
        codeNumber: doc.codeNumber,
        uuid: doc.upstreamUuid,
        status: doc.upstreamStatus || doc.initialResult || "PENDING",
        longId: doc.longId,
        dateTimeValidated: doc.dateTimeValidated?.toISOString() || null,
        issuerTin: doc.issuerTin,
        issuerName: doc.issuerName,
        receiverId: doc.receiverId,
        receiverName: doc.receiverName,
        totalPayableAmount: doc.totalPayableAmount,
        ...(doc.errorCode && {
          lastError: {
            httpStatus: 400,
            messageEN: doc.errorMessage || "Error",
            errorCode: doc.errorCode,
          },
        }),
      }));

      const response = {
        trackingId: submission.trackingId,
        submissionUid: submission.upstreamSubmissionUid || "",
        status: submission.status,
        overallStatus: submission.upstreamOverallStatus || null,
        documents,
        // Polling state
        lastPolledAt: submission.lastPolledAt?.toISOString() || null,
        nextPollAt: submission.nextPollAt?.toISOString() || null,
        pollAttempts: submission.pollAttempts,
        finalizedAt: submission.finalizedAt?.toISOString() || null,
        // Error info
        ...(submission.lastPollErrorCode && {
          lastPollError: {
            errorCode: submission.lastPollErrorCode,
            message: submission.lastPollErrorMessage,
          },
        }),
        createdAt: submission.createdAt.toISOString(),
        updatedAt: submission.updatedAt.toISOString(),
      };

      reply.header("X-Correlation-Id", correlationId);
      return reply.status(200).send(response);
    }
  );

  /**
   * POST /v1/submissions/:trackingId/poll - Trigger manual poll
   *
   * Enqueues an immediate poll if:
   * - Submission exists with upstreamSubmissionUid
   * - Submission is not already finalized
   * - Minimum poll interval has passed (returns 429 otherwise)
   */
  fastify.post<{ Params: { trackingId: string } }>(
    "/v1/submissions/:trackingId/poll",
    async (request, reply) => {
      const correlationId = request.correlationId || request.id;
      const { trackingId } = request.params;

      const submission = await getByTrackingIdWithPolling(trackingId);
      if (!submission) {
        throw new AppError(404, "Submission not found", "SUBMISSION_NOT_FOUND");
      }

      // Check if submission has been submitted to upstream
      if (!submission.upstreamSubmissionUid) {
        throw new AppError(
          409,
          "Submission has not been sent to upstream yet",
          "SUBMISSION_NOT_READY"
        );
      }

      // Check if already finalized
      if (submission.finalizedAt) {
        // Return success - already complete
        reply.header("X-Correlation-Id", correlationId);
        return reply.status(200).send({
          trackingId: submission.trackingId,
          message: "Submission already finalized",
          overallStatus: submission.upstreamOverallStatus,
          finalizedAt: submission.finalizedAt.toISOString(),
        });
      }

      // Check minimum poll interval
      const now = Date.now();
      if (submission.lastPolledAt) {
        const elapsed = now - submission.lastPolledAt.getTime();
        if (elapsed < MIN_POLL_INTERVAL_MS) {
          const retryAfterSeconds = Math.ceil((MIN_POLL_INTERVAL_MS - elapsed) / 1000);
          const envelope = createErrorEnvelope(
            429,
            "Poll request too soon. Please wait before retrying.",
            {
              correlationId,
              errorCode: "POLL_TOO_SOON",
              retryAfterSeconds,
            }
          );

          reply.header("X-Correlation-Id", correlationId);
          reply.header("Retry-After", String(retryAfterSeconds));
          return reply.status(429).send(envelope);
        }
      }

      // Enqueue immediate poll
      const jobId = await enqueueImmediatePoll(trackingId);

      if (!jobId) {
        throw new AppError(
          503,
          "Failed to enqueue poll job. Queue may be unavailable.",
          "QUEUE_UNAVAILABLE"
        );
      }

      request.log.info(
        { correlationId, trackingId, jobId },
        "Manual poll enqueued"
      );

      reply.header("X-Correlation-Id", correlationId);
      return reply.status(202).send({
        trackingId: submission.trackingId,
        message: "Poll job enqueued",
        jobId,
      });
    }
  );
};
