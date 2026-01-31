/**
 * Get Submission API - GET /api/v1.0/documentsubmissions/{submissionUid}
 *
 * Retrieves submission status and document summaries from MyInvois.
 * Used for polling submission processing status.
 */

import { resolveSystemBaseUrl, type RateLimiter } from "@myinvois/core";
import type { SessionCredentials, UpstreamMeta, UpstreamError } from "../types.js";
import { TokenManager } from "../tokenManager.js";
import { RATE_LIMITS } from "../rateLimits.js";
import type {
  GetSubmissionParams,
  GetSubmissionResponse,
  GetSubmissionUpstreamResponse,
  NormalizedDocumentSummary,
  DocumentSummaryUpstream,
} from "./types.js";

const GET_SUBMISSION_PATH = "/api/v1.0/documentsubmissions/";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_RETRY_AFTER = 60;

/**
 * Extract upstream metadata from response headers
 */
function extractUpstreamMeta(headers: Headers): UpstreamMeta {
  const meta: UpstreamMeta = {};

  const correlationId = headers.get("correlationid") || headers.get("x-correlation-id");
  if (correlationId) meta.correlationId = correlationId;

  const limit = headers.get("x-rate-limit-limit");
  if (limit) meta.rateLimitLimit = parseInt(limit, 10);

  const remaining = headers.get("x-rate-limit-remaining");
  if (remaining) meta.rateLimitRemaining = parseInt(remaining, 10);

  const reset = headers.get("x-rate-limit-reset");
  if (reset) meta.rateLimitReset = parseInt(reset, 10);

  return meta;
}

/**
 * Get retry-after seconds from response
 */
function getRetryAfterSeconds(headers: Headers, meta: UpstreamMeta): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const parsed = parseInt(retryAfter, 10);
    if (!isNaN(parsed)) return parsed;
  }

  if (meta.rateLimitReset) {
    const now = Math.floor(Date.now() / 1000);
    const delta = meta.rateLimitReset - now;
    if (delta > 0) return delta;
  }

  return DEFAULT_RETRY_AFTER;
}

/**
 * Normalize a document summary from upstream response
 */
function normalizeDocumentSummary(doc: DocumentSummaryUpstream): NormalizedDocumentSummary {
  return {
    uuid: doc.uuid,
    longId: doc.longId ?? null,
    codeNumber: doc.internalId,
    status: doc.status,
    dateTimeValidated: doc.dateTimeValidated ? new Date(doc.dateTimeValidated) : null,
    issuerTin: doc.issuerTin,
    issuerName: doc.issuerName ?? null,
    receiverId: doc.receiverId ?? null,
    receiverName: doc.receiverName ?? null,
    totalPayableAmount:
      doc.totalPayableAmount !== undefined ? doc.totalPayableAmount.toString() : null,
  };
}

export interface GetSubmissionOptions {
  /** Token manager instance */
  tokenManager: TokenManager;
  /** Rate limiter instance */
  rateLimiter?: RateLimiter;
}

/**
 * Get submission status from MyInvois
 *
 * @param session - Session credentials
 * @param params - Get submission parameters
 * @param options - Options
 * @returns Get submission response
 */
export async function getSubmission(
  session: SessionCredentials,
  params: GetSubmissionParams,
  options: GetSubmissionOptions
): Promise<GetSubmissionResponse> {
  const { tokenManager, rateLimiter } = options;
  const { submissionUid, pageNo = 1, pageSize = DEFAULT_PAGE_SIZE } = params;

  // Check rate limit if limiter provided
  if (rateLimiter) {
    const result = rateLimiter.consume(session.clientId, RATE_LIMITS.GET_SUBMISSION);
    if (!result.allowed) {
      return {
        ok: false,
        error: {
          status: 429,
          message: "Get submission rate limit exceeded",
          code: "RATE_LIMIT_EXCEEDED",
          meta: {
            rateLimitLimit: result.limit,
            rateLimitRemaining: result.remaining,
          },
        },
      };
    }
  }

  // Get auth token
  const tokenResult = await tokenManager.getToken(session);
  if (!tokenResult.ok) {
    return {
      ok: false,
      error: tokenResult.error,
    };
  }

  const baseUrl = resolveSystemBaseUrl(session.env);
  const url = `${baseUrl}${GET_SUBMISSION_PATH}${submissionUid}?pageNo=${pageNo}&pageSize=${pageSize}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenResult.token.accessToken}`,
    Accept: "application/json",
  };

  // Add onbehalfof header for intermediary mode
  if (session.mode === "INTERMEDIARY" && session.onBehalfOf) {
    headers.onbehalfof = session.onBehalfOf;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    const meta = extractUpstreamMeta(response.headers);

    // Handle 200 OK (success)
    if (response.status === 200) {
      const body = (await response.json()) as GetSubmissionUpstreamResponse;
      return {
        ok: true,
        result: {
          submissionUid: body.submissionUid,
          overallStatus: body.overallStatus,
          documentCount: body.documentCount,
          dateTimeReceived: new Date(body.dateTimeReceived),
          documentSummary: (body.documentSummary || []).map(normalizeDocumentSummary),
          meta,
        },
      };
    }

    // Handle 429 - Rate limit exceeded
    if (response.status === 429) {
      const retryAfterSeconds = getRetryAfterSeconds(response.headers, meta);
      const error: UpstreamError = {
        status: 429,
        message: "Upstream rate limit exceeded",
        code: "UPSTREAM_RATE_LIMIT",
        meta: {
          ...meta,
          rateLimitReset: Math.floor(Date.now() / 1000) + retryAfterSeconds,
        },
      };
      return { ok: false, error };
    }

    // Handle 401 - try refresh token once
    if (response.status === 401) {
      const refreshResult = await tokenManager.refreshToken(session);
      if (refreshResult.ok) {
        // Retry with new token
        headers.Authorization = `Bearer ${refreshResult.token.accessToken}`;
        const retryResponse = await fetch(url, {
          method: "GET",
          headers,
        });

        const retryMeta = extractUpstreamMeta(retryResponse.headers);

        if (retryResponse.status === 200) {
          const body = (await retryResponse.json()) as GetSubmissionUpstreamResponse;
          return {
            ok: true,
            result: {
              submissionUid: body.submissionUid,
              overallStatus: body.overallStatus,
              documentCount: body.documentCount,
              dateTimeReceived: new Date(body.dateTimeReceived),
              documentSummary: (body.documentSummary || []).map(normalizeDocumentSummary),
              meta: retryMeta,
            },
          };
        }

        // Still failed after refresh
        return buildErrorResponse(retryResponse, retryMeta);
      }

      // Refresh failed
      return {
        ok: false,
        error: refreshResult.error,
      };
    }

    // Handle 404 - submission not found
    if (response.status === 404) {
      return {
        ok: false,
        error: {
          status: 404,
          message: "Submission not found",
          code: "SUBMISSION_NOT_FOUND",
          meta,
        },
      };
    }

    // Handle other errors
    return buildErrorResponse(response, meta);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return {
      ok: false,
      error: {
        status: 0,
        message,
        code: "NETWORK_ERROR",
      },
    };
  }
}

/**
 * Build error response from upstream response
 */
async function buildErrorResponse(
  response: Response,
  meta: UpstreamMeta
): Promise<GetSubmissionResponse> {
  let message = `Request failed with status ${response.status}`;
  let code = "UPSTREAM_ERROR";

  try {
    const errorBody = (await response.json()) as Record<string, unknown>;
    if (typeof errorBody.message === "string") {
      message = errorBody.message;
    } else if (typeof errorBody.error === "string") {
      message = errorBody.error;
    }
    if (typeof errorBody.code === "string") {
      code = errorBody.code;
    }
  } catch {
    // Ignore JSON parse errors
  }

  return {
    ok: false,
    error: {
      status: response.status,
      message,
      code,
      meta,
    },
  };
}

/**
 * Check if status is terminal (no more polling needed)
 */
export function isTerminalStatus(status: string): boolean {
  return status === "valid" || status === "invalid" || status === "partially valid";
}
