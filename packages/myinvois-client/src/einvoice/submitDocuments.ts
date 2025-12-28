/**
 * Submit Documents API - POST /api/v1.0/documentsubmissions/
 *
 * Submits documents to MyInvois for processing.
 * Returns 202 with submissionUid, acceptedDocuments, and rejectedDocuments.
 */

import { resolveSystemBaseUrl, type RateLimiter } from "@myinvois/core";
import type { SessionCredentials, UpstreamMeta, UpstreamError } from "../types.js";
import { TokenManager } from "../tokenManager.js";
import { RATE_LIMITS } from "../rateLimits.js";
import type {
  SubmitDocumentsRequest,
  SubmitDocumentsResponse,
  SubmitDocumentsUpstreamResponse,
  NormalizedAcceptedDocument,
  NormalizedRejectedDocument,
} from "./types.js";

const SUBMIT_PATH = "/api/v1.0/documentsubmissions/";
const DEFAULT_RETRY_AFTER = 60;
const DEFAULT_TIMEOUT_MS = parseInt(process.env.UPSTREAM_TIMEOUT_POST_MS || "20000", 10);

/**
 * Create AbortController with timeout
 */
function createTimeoutController(timeoutMs: number): { controller: AbortController; timeoutId: NodeJS.Timeout } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

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
 * Normalize accepted documents from upstream response
 */
function normalizeAccepted(
  docs: SubmitDocumentsUpstreamResponse["acceptedDocuments"]
): NormalizedAcceptedDocument[] {
  return docs.map((d) => ({
    codeNumber: d.invoiceCodeNumber,
    uuid: d.uuid,
  }));
}

/**
 * Normalize rejected documents from upstream response
 */
function normalizeRejected(
  docs: SubmitDocumentsUpstreamResponse["rejectedDocuments"]
): NormalizedRejectedDocument[] {
  return docs.map((d) => ({
    codeNumber: d.invoiceCodeNumber,
    errorCode: d.error?.code,
    errorMessage: d.error?.message,
  }));
}

export interface SubmitDocumentsOptions {
  /** Token manager instance */
  tokenManager: TokenManager;
  /** Rate limiter instance */
  rateLimiter?: RateLimiter;
}

/**
 * Submit documents to MyInvois
 *
 * @param session - Session credentials
 * @param request - Submit documents request
 * @param options - Submit options
 * @returns Submit documents response
 */
export async function submitDocuments(
  session: SessionCredentials,
  request: SubmitDocumentsRequest,
  options: SubmitDocumentsOptions
): Promise<SubmitDocumentsResponse> {
  const { tokenManager, rateLimiter } = options;

  // Check rate limit if limiter provided
  if (rateLimiter) {
    const result = rateLimiter.consume(session.clientId, RATE_LIMITS.SUBMIT);
    if (!result.allowed) {
      return {
        ok: false,
        error: {
          status: 429,
          message: "Submit rate limit exceeded",
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
  const url = `${baseUrl}${SUBMIT_PATH}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenResult.token.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Create timeout controller
  const { controller, timeoutId } = createTimeoutController(DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const meta = extractUpstreamMeta(response.headers);

    // Handle 202 Accepted (success)
    if (response.status === 202) {
      const body = (await response.json()) as SubmitDocumentsUpstreamResponse;
      return {
        ok: true,
        result: {
          submissionUid: body.submissionUid,
          acceptedDocuments: normalizeAccepted(body.acceptedDocuments || []),
          rejectedDocuments: normalizeRejected(body.rejectedDocuments || []),
          meta,
        },
      };
    }

    // Handle 422 - could be DuplicateSubmission
    if (response.status === 422) {
      const retryAfterSeconds = getRetryAfterSeconds(response.headers, meta);
      let errorMessage = "Validation error";
      let errorCode = "VALIDATION_ERROR";

      try {
        const errorBody = (await response.json()) as Record<string, unknown>;
        if (typeof errorBody.message === "string") {
          errorMessage = errorBody.message;
        }
        if (typeof errorBody.code === "string") {
          errorCode = errorBody.code;
        }
        // Check for duplicate submission
        if (
          errorCode === "DuplicateSubmission" ||
          errorMessage.toLowerCase().includes("duplicate")
        ) {
          errorCode = "DUPLICATE_SUBMISSION";
        }
      } catch {
        // Ignore JSON parse errors
      }

      const error: UpstreamError = {
        status: 422,
        message: errorMessage,
        code: errorCode,
        meta: {
          ...meta,
          rateLimitReset: Math.floor(Date.now() / 1000) + retryAfterSeconds,
        },
      };

      return { ok: false, error };
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
        // Retry with new token and fresh timeout
        const { controller: retryController, timeoutId: retryTimeoutId } = createTimeoutController(DEFAULT_TIMEOUT_MS);
        headers.Authorization = `Bearer ${refreshResult.token.accessToken}`;

        let retryResponse: Response;
        try {
          retryResponse = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
            signal: retryController.signal,
          });
          clearTimeout(retryTimeoutId);
        } catch (retryError) {
          clearTimeout(retryTimeoutId);
          const isTimeout = retryError instanceof Error && retryError.name === "AbortError";
          return {
            ok: false,
            error: {
              status: 0,
              message: isTimeout ? "Request timed out" : "Network error",
              code: isTimeout ? "TIMEOUT_ERROR" : "NETWORK_ERROR",
            },
          };
        }

        const retryMeta = extractUpstreamMeta(retryResponse.headers);

        if (retryResponse.status === 202) {
          const body = (await retryResponse.json()) as SubmitDocumentsUpstreamResponse;
          return {
            ok: true,
            result: {
              submissionUid: body.submissionUid,
              acceptedDocuments: normalizeAccepted(body.acceptedDocuments || []),
              rejectedDocuments: normalizeRejected(body.rejectedDocuments || []),
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

    // Handle other errors
    return buildErrorResponse(response, meta);
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: {
        status: 0,
        message: isTimeout ? "Request timed out" : (error instanceof Error ? error.message : "Network error"),
        code: isTimeout ? "TIMEOUT_ERROR" : "NETWORK_ERROR",
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
): Promise<SubmitDocumentsResponse> {
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
