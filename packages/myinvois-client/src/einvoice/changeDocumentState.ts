/**
 * Change Document State API - PUT /api/v1.0/documents/state/{UUID}/state
 *
 * Changes document state to cancelled or rejected.
 * Used for Cancel Document (issuer) and Reject Document (receiver).
 */

import { resolveSystemBaseUrl, type RateLimiter } from "@myinvois/core";
import type { SessionCredentials, UpstreamMeta, UpstreamError } from "../types.js";
import { TokenManager } from "../tokenManager.js";
import { RATE_LIMITS } from "../rateLimits.js";
import type {
  ChangeDocumentStateParams,
  ChangeDocumentStateResponse,
  ChangeDocumentStateUpstreamResponse,
  DocumentStateAction,
} from "./types.js";

const STATE_CHANGE_PATH = "/api/v1.0/documents/state/";
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
 * Get rate limit for action type
 */
function getRateLimitForAction(action: DocumentStateAction): number {
  return action === "cancelled" ? RATE_LIMITS.CANCEL : RATE_LIMITS.REJECT;
}

export interface ChangeDocumentStateOptions {
  /** Token manager instance */
  tokenManager: TokenManager;
  /** Rate limiter instance */
  rateLimiter?: RateLimiter;
}

/**
 * Change document state (cancel or reject)
 *
 * @param session - Session credentials
 * @param params - State change parameters
 * @param options - Options
 * @returns State change response
 */
export async function changeDocumentState(
  session: SessionCredentials,
  params: ChangeDocumentStateParams,
  options: ChangeDocumentStateOptions
): Promise<ChangeDocumentStateResponse> {
  const { tokenManager, rateLimiter } = options;
  const { uuid, status, reason } = params;

  // Check rate limit if limiter provided
  if (rateLimiter) {
    const rpmLimit = getRateLimitForAction(status);
    const result = rateLimiter.consume(session.clientId, rpmLimit);
    if (!result.allowed) {
      return {
        ok: false,
        error: {
          status: 429,
          message: `${status === "cancelled" ? "Cancel" : "Reject"} rate limit exceeded`,
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
  const url = `${baseUrl}${STATE_CHANGE_PATH}${uuid}/state`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenResult.token.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const body = { status, reason };

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });

    const meta = extractUpstreamMeta(response.headers);

    // Handle 200 OK (success)
    if (response.status === 200) {
      const responseBody = (await response.json()) as ChangeDocumentStateUpstreamResponse;
      return {
        ok: true,
        result: {
          uuid: responseBody.uuid,
          status: responseBody.status,
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
        headers.Authorization = `Bearer ${refreshResult.token.accessToken}`;
        const retryResponse = await fetch(url, {
          method: "PUT",
          headers,
          body: JSON.stringify(body),
        });

        const retryMeta = extractUpstreamMeta(retryResponse.headers);

        if (retryResponse.status === 200) {
          const responseBody = (await retryResponse.json()) as ChangeDocumentStateUpstreamResponse;
          return {
            ok: true,
            result: {
              uuid: responseBody.uuid,
              status: responseBody.status,
              meta: retryMeta,
            },
          };
        }

        return buildErrorResponse(retryResponse, retryMeta);
      }

      return {
        ok: false,
        error: refreshResult.error,
      };
    }

    // Handle 404 - document not found
    if (response.status === 404) {
      return {
        ok: false,
        error: {
          status: 404,
          message: "Document not found",
          code: "DOCUMENT_NOT_FOUND",
          meta,
        },
      };
    }

    // Handle 400 - validation error (e.g., already cancelled, outside 72-hour window)
    if (response.status === 400) {
      let message = "Invalid request";
      let code = "VALIDATION_ERROR";

      try {
        const errorBody = (await response.json()) as Record<string, unknown>;
        if (typeof errorBody.message === "string") {
          message = errorBody.message;
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
          status: 400,
          message,
          code,
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
): Promise<ChangeDocumentStateResponse> {
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
