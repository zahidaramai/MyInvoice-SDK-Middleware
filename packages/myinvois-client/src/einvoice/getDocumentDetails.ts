/**
 * Get Document Details API - GET /api/v1.0/documents/{uuid}/details
 *
 * Retrieves detailed information about a document.
 */

import { resolveSystemBaseUrl, type RateLimiter } from "@myinvois/core";
import type { SessionCredentials, UpstreamMeta, UpstreamError } from "../types.js";
import { TokenManager } from "../tokenManager.js";
import { RATE_LIMITS } from "../rateLimits.js";
import type {
  GetDocumentDetailsParams,
  GetDocumentDetailsResponse,
  DocumentDetailsUpstream,
} from "./types.js";

const DOCUMENT_DETAILS_PATH = "/api/v1.0/documents/";
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
 * Parse date string to Date or null
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

export interface GetDocumentDetailsOptions {
  /** Token manager instance */
  tokenManager: TokenManager;
  /** Rate limiter instance */
  rateLimiter?: RateLimiter;
}

/**
 * Get document details from MyInvois
 *
 * @param session - Session credentials
 * @param params - Get document details parameters
 * @param options - Options
 * @returns Document details response
 */
export async function getDocumentDetails(
  session: SessionCredentials,
  params: GetDocumentDetailsParams,
  options: GetDocumentDetailsOptions
): Promise<GetDocumentDetailsResponse> {
  const { tokenManager, rateLimiter } = options;
  const { uuid } = params;

  // Check rate limit if limiter provided
  if (rateLimiter) {
    const result = rateLimiter.consume(session.clientId, RATE_LIMITS.GET_DOCUMENT_DETAILS);
    if (!result.allowed) {
      return {
        ok: false,
        error: {
          status: 429,
          message: "Get document details rate limit exceeded",
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
  const url = `${baseUrl}${DOCUMENT_DETAILS_PATH}${uuid}/details`;

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
      const body = (await response.json()) as DocumentDetailsUpstream;
      return {
        ok: true,
        result: {
          uuid: body.uuid,
          submissionUid: body.submissionUid,
          longId: body.longId ?? null,
          internalId: body.internalId,
          typeName: body.typeName,
          issuerTin: body.issuerTin,
          issuerName: body.issuerName ?? null,
          receiverId: body.receiverId ?? null,
          receiverName: body.receiverName ?? null,
          dateTimeIssued: parseDate(body.dateTimeIssued),
          dateTimeReceived: parseDate(body.dateTimeReceived),
          dateTimeValidated: parseDate(body.dateTimeValidated),
          totalPayableAmount: body.totalPayableAmount !== undefined
            ? body.totalPayableAmount.toString()
            : null,
          status: body.status,
          cancelDateTime: parseDate(body.cancelDateTime),
          rejectDateTime: parseDate(body.rejectDateTime),
          statusReason: body.documentStatusReason ?? null,
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
          method: "GET",
          headers,
        });

        const retryMeta = extractUpstreamMeta(retryResponse.headers);

        if (retryResponse.status === 200) {
          const body = (await retryResponse.json()) as DocumentDetailsUpstream;
          return {
            ok: true,
            result: {
              uuid: body.uuid,
              submissionUid: body.submissionUid,
              longId: body.longId ?? null,
              internalId: body.internalId,
              typeName: body.typeName,
              issuerTin: body.issuerTin,
              issuerName: body.issuerName ?? null,
              receiverId: body.receiverId ?? null,
              receiverName: body.receiverName ?? null,
              dateTimeIssued: parseDate(body.dateTimeIssued),
              dateTimeReceived: parseDate(body.dateTimeReceived),
              dateTimeValidated: parseDate(body.dateTimeValidated),
              totalPayableAmount: body.totalPayableAmount !== undefined
                ? body.totalPayableAmount.toString()
                : null,
              status: body.status,
              cancelDateTime: parseDate(body.cancelDateTime),
              rejectDateTime: parseDate(body.rejectDateTime),
              statusReason: body.documentStatusReason ?? null,
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
): Promise<GetDocumentDetailsResponse> {
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
