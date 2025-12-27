/**
 * Get Document API - GET /api/v1.0/documents/{uuid}/raw/{longId}
 *
 * Retrieves the raw document content from MyInvois.
 */

import { resolveSystemBaseUrl, type RateLimiter } from "@myinvois/core";
import type { SessionCredentials, UpstreamMeta, UpstreamError } from "../types.js";
import { TokenManager } from "../tokenManager.js";
import { RATE_LIMITS } from "../rateLimits.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for getting a raw document
 */
export interface GetDocumentParams {
  /** Document UUID */
  uuid: string;
  /** Document Long ID */
  longId: string;
}

/**
 * Result for get document
 */
export interface GetDocumentResult {
  /** Raw document content (UBL XML or JSON) */
  document: string;
  /** Document format */
  format: "XML" | "JSON";
  /** Upstream metadata */
  meta: UpstreamMeta;
}

/**
 * Response type for getDocument
 */
export type GetDocumentResponse =
  | { ok: true; result: GetDocumentResult }
  | { ok: false; error: UpstreamError };

// =============================================================================
// Helper Functions
// =============================================================================

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

function detectFormat(content: string, contentType: string | null): "XML" | "JSON" {
  // Check content type header first
  if (contentType) {
    if (contentType.includes("xml")) return "XML";
    if (contentType.includes("json")) return "JSON";
  }

  // Fall back to content inspection
  const trimmed = content.trim();
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
    return "XML";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "JSON";
  }

  // Default to JSON
  return "JSON";
}

// =============================================================================
// API Function
// =============================================================================

export interface GetDocumentOptions {
  tokenManager: TokenManager;
  rateLimiter?: RateLimiter;
}

/**
 * Get raw document from MyInvois
 *
 * @param session - Session credentials
 * @param params - Document parameters (uuid and longId)
 * @param options - Options with token manager
 * @returns Raw document response
 */
export async function getDocument(
  session: SessionCredentials,
  params: GetDocumentParams,
  options: GetDocumentOptions
): Promise<GetDocumentResponse> {
  const { tokenManager, rateLimiter } = options;
  const { uuid, longId } = params;

  // Check rate limit if limiter provided
  if (rateLimiter) {
    const result = rateLimiter.consume(session.clientId, RATE_LIMITS.GET_DOCUMENT);
    if (!result.allowed) {
      return {
        ok: false,
        error: {
          status: 429,
          message: "Get document rate limit exceeded",
          code: "RATE_LIMIT_EXCEEDED",
          meta: {
            rateLimitLimit: result.limit,
            rateLimitRemaining: result.remaining,
          },
        },
      };
    }
  }

  const tokenResult = await tokenManager.getToken(session);
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error };
  }

  const baseUrl = resolveSystemBaseUrl(session.env);
  const url = `${baseUrl}/api/v1.0/documents/${uuid}/raw/${longId}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenResult.token.accessToken}`,
    Accept: "*/*",
  };

  // Add onbehalfof header for intermediary mode
  if (session.onBehalfOf) {
    headers["onbehalfof"] = session.onBehalfOf;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    const meta = extractUpstreamMeta(response.headers);

    if (response.ok) {
      const document = await response.text();
      const contentType = response.headers.get("content-type");
      const format = detectFormat(document, contentType);

      return {
        ok: true,
        result: {
          document,
          format,
          meta,
        },
      };
    }

    // Handle 429 - Rate limit
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      return {
        ok: false,
        error: {
          status: 429,
          message: "Upstream rate limit exceeded",
          code: "UPSTREAM_RATE_LIMIT",
          meta: {
            ...meta,
            rateLimitReset: retryAfter ? parseInt(retryAfter, 10) : undefined,
          },
        },
      };
    }

    // Handle 401 - Unauthorized
    if (response.status === 401) {
      const refreshResult = await tokenManager.refreshToken(session);
      if (refreshResult.ok) {
        headers.Authorization = `Bearer ${refreshResult.token.accessToken}`;
        const retryResponse = await fetch(url, { method: "GET", headers });
        const retryMeta = extractUpstreamMeta(retryResponse.headers);

        if (retryResponse.ok) {
          const document = await retryResponse.text();
          const contentType = retryResponse.headers.get("content-type");
          const format = detectFormat(document, contentType);

          return {
            ok: true,
            result: {
              document,
              format,
              meta: retryMeta,
            },
          };
        }
      }

      return {
        ok: false,
        error: {
          status: 401,
          message: "Unauthorized",
          code: "UNAUTHORIZED",
          meta,
        },
      };
    }

    // Handle 404 - Document not found
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
    const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: false,
      error: {
        status: response.status,
        message: (errorBody.message as string) || `Request failed with status ${response.status}`,
        code: (errorBody.code as string) || "UPSTREAM_ERROR",
        meta,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        status: 0,
        message: error instanceof Error ? error.message : "Network error",
        code: "NETWORK_ERROR",
      },
    };
  }
}
