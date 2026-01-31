/**
 * Submissions routes - POST /v1/submissions
 */

import type { FastifyPluginAsync } from "fastify";
import { AppError, createErrorEnvelope, ErrorCodes, isRetryableError } from "../../lib/errors.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { getTokenManager, getRateLimiter } from "../../lib/myinvois.js";
import { isValidSessionId } from "../../lib/validation.js";
import {
  prepareDocument,
  validateSubmissionConstraints,
  computePayloadHash,
  generateTrackingId,
  encodeBase64,
  hashDocument,
  type GatewayDocumentInput,
  type PreparedDocument,
} from "../../lib/submission.js";
import {
  signDocuments,
  getEffectiveDocumentVersion,
  shouldSign,
  type SignableDocument,
} from "../../middleware/signing.js";
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
 * Map MyInvois error codes to normalized gateway error codes
 */
function normalizeErrorCode(rawCode: string): { code: string; retryable: boolean; httpStatus?: number } {
  const codeMap: Record<string, { code: string; retryable: boolean; httpStatus?: number }> = {
    // Business validation errors
    TaxpayerNotFound: { code: ErrorCodes.INVALID_TAXPAYER, retryable: false },
    TotalsMismatch: { code: ErrorCodes.INVALID_TOTALS, retryable: false },
    InvalidDocumentRelation: { code: ErrorCodes.INVALID_DOCUMENT_RELATION, retryable: false },
    DuplicateSubmission: { code: ErrorCodes.DUPLICATE_SUBMISSION, retryable: false },
    ValidationError: { code: ErrorCodes.DOCUMENT_VALIDATION_FAILED, retryable: false },
    // Infrastructure errors
    InternalError: { code: ErrorCodes.UPSTREAM_ERROR, retryable: true },
    RateLimitExceeded: { code: ErrorCodes.UPSTREAM_RATE_LIMITED, retryable: true },
    TIMEOUT_ERROR: { code: ErrorCodes.UPSTREAM_TIMEOUT, retryable: true, httpStatus: 504 },
    NETWORK_ERROR: { code: ErrorCodes.NETWORK_ERROR, retryable: true, httpStatus: 503 },
    // Auth errors
    invalid_client: { code: ErrorCodes.AUTH_INVALID_CLIENT, retryable: false },
    invalid_token: { code: ErrorCodes.AUTH_TOKEN_EXPIRED, retryable: false },
  };

  const mapped = codeMap[rawCode];
  if (mapped) {
    return mapped;
  }

  // Check if it's a retryable code based on the gateway's isRetryableError
  return {
    code: rawCode,
    retryable: isRetryableError(rawCode),
  };
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

      // Determine effective document version for this session
      const documentVersion = getEffectiveDocumentVersion(session.documentVersion);

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

      // Sign documents if v1.1 is requested
      if (shouldSign(documentVersion)) {
        request.log.info(
          { correlationId, documentCount: preparedDocs.length, documentVersion },
          "Signing documents for v1.1 submission"
        );

        // Validate that all documents are JSON (required for signing)
        const xmlDocs = preparedDocs.filter((doc) => doc.format === "XML");
        if (xmlDocs.length > 0) {
          throw new AppError(
            400,
            "XML documents cannot be signed. Use JSON format for v1.1 submissions.",
            "INVALID_DOCUMENT_FORMAT",
            { propertyPath: "documents" }
          );
        }

        // Convert PreparedDocument to SignableDocument
        const signableDocuments: SignableDocument[] = body.documents.map((inputDoc, index) => {
          // Parse JSON content for signing
          let content: Record<string, unknown>;
          try {
            if (inputDoc.rawDocument) {
              content = JSON.parse(inputDoc.rawDocument);
            } else if (inputDoc.documentBase64) {
              const decoded = Buffer.from(inputDoc.documentBase64, "base64").toString("utf-8");
              content = JSON.parse(decoded);
            } else {
              throw new Error("No document content");
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "Invalid JSON";
            throw new AppError(400, `Failed to parse JSON document: ${message}`, "INVALID_DOCUMENT", {
              propertyPath: `documents[${index}]`,
            });
          }

          return {
            content,
            codeNumber: inputDoc.codeNumber,
            format: inputDoc.format as "JSON" | "XML",
          };
        });

        // Sign the documents
        const signedDocuments = signDocuments(signableDocuments, {
          documentVersion,
          correlationId,
          logger: {
            info: (obj, msg) => request.log.info(obj, msg),
            warn: (obj, msg) => request.log.warn(obj, msg),
            error: (obj, msg) => request.log.error(obj, msg),
          },
        });

        // Re-prepare documents with signed content
        preparedDocs = signedDocuments.map((signed) => {
          const signedJson = JSON.stringify(signed.content);
          const document = encodeBase64(signedJson);
          const documentHash = hashDocument(signedJson);
          const estimatedSizeBytes = Buffer.byteLength(signedJson, "utf-8");

          return {
            format: signed.format,
            codeNumber: signed.codeNumber,
            document,
            documentHash,
            estimatedSizeBytes,
          };
        });

        request.log.info(
          { correlationId, signedCount: preparedDocs.length },
          "Documents signed successfully"
        );
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
        // Store error in database (with normalized code)
        const normalizedForStorage = normalizeErrorCode(result.error.code || "UPSTREAM_ERROR");
        await markSubmissionError({
          trackingId,
          errorCode: normalizedForStorage.code,
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

        if (result.error.status === 429 || result.error.code === "UPSTREAM_RATE_LIMIT" || result.error.code === "RATE_LIMIT_EXCEEDED") {
          const retryAfter = result.error.meta?.rateLimitReset
            ? result.error.meta.rateLimitReset - Math.floor(Date.now() / 1000)
            : 60;

          const envelope = createErrorEnvelope(429, result.error.message, {
            correlationId: result.error.meta?.correlationId || correlationId,
            errorCode: ErrorCodes.UPSTREAM_RATE_LIMITED,
            retryAfterSeconds: retryAfter,
            retryable: true,
          });

          reply.header("X-Correlation-Id", result.error.meta?.correlationId || correlationId);
          reply.header("Retry-After", String(retryAfter));
          return reply.status(429).send(envelope);
        }

        // Normalize error code
        const normalized = normalizeErrorCode(result.error.code || "UPSTREAM_ERROR");

        // Handle timeout/network errors (status 0) - these need special httpStatus
        if (result.error.status === 0) {
          throw new AppError(
            normalized.httpStatus || 504,
            result.error.message,
            normalized.code,
            {
              correlationId: result.error.meta?.correlationId,
              retryable: normalized.retryable,
            }
          );
        }

        // Handle 5xx upstream errors (retryable)
        if (result.error.status && result.error.status >= 500) {
          throw new AppError(
            result.error.status,
            result.error.message,
            normalized.code,
            {
              correlationId: result.error.meta?.correlationId,
              retryable: true,
            }
          );
        }

        // Generic upstream error (4xx business errors)
        throw new AppError(
          normalized.httpStatus || result.error.status || 500,
          result.error.message,
          normalized.code,
          {
            correlationId: result.error.meta?.correlationId,
            retryable: normalized.retryable,
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

      // P0-09: Enqueue poll job with retry and proper error logging
      // Fire-and-forget but with single retry and error-level logging
      // Auto-poller (5min interval) will catch documents if enqueue fails
      enqueuePoll(trackingId, pollDelay).catch(async (firstErr) => {
        // Retry once after 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));
        enqueuePoll(trackingId, pollDelay).catch((retryErr) => {
          request.log.error(
            { trackingId, firstError: firstErr?.message, retryError: retryErr?.message },
            "Poll job enqueue failed after retry - auto-poller will catch this document"
          );
        });
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
