/**
 * Validate Taxpayer TIN API - GET /api/v1.0/taxpayer/validate/{tin}
 *
 * Validates a taxpayer's TIN against MyInvois identity records.
 * Returns 200 if valid, 404 if TIN+ID combination is invalid/not found.
 */

import { resolveSystemBaseUrl, type RateLimiter } from "@myinvois/core";
import type { SessionCredentials, UpstreamMeta, UpstreamError } from "../types.js";
import { TokenManager } from "../tokenManager.js";
import { RATE_LIMITS } from "../rateLimits.js";
import type {
  ValidateTinParams,
  ValidateTinResponse,
  ValidateTinUpstreamResponse,
} from "./types.js";

const VALIDATE_TIN_PATH = "/api/v1.0/taxpayer/validate/";
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

export interface ValidateTinOptions {
  /** Token manager instance */
  tokenManager: TokenManager;
  /** Rate limiter instance */
  rateLimiter?: RateLimiter;
}

/**
 * Validate taxpayer TIN
 *
 * @param session - Session credentials
 * @param params - Validation parameters
 * @param options - Options
 * @returns Validation response
 */
export async function validateTaxpayerTin(
  session: SessionCredentials,
  params: ValidateTinParams,
  options: ValidateTinOptions
): Promise<ValidateTinResponse> {
  const { tokenManager, rateLimiter } = options;
  const { tin, idType, idValue } = params;

  // Check rate limit if limiter provided
  if (rateLimiter) {
    const result = rateLimiter.consume(session.clientId, RATE_LIMITS.VALIDATE_TIN);
    if (!result.allowed) {
      return {
        ok: false,
        error: {
          status: 429,
          message: "TIN validation rate limit exceeded",
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
  const url = `${baseUrl}${VALIDATE_TIN_PATH}${encodeURIComponent(tin)}?idType=${encodeURIComponent(idType)}&idValue=${encodeURIComponent(idValue)}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenResult.token.accessToken}`,
    Accept: "application/json",
  };

  // Add onBehalfOf header for intermediary mode
  if (session.mode === "INTERMEDIARY" && session.onBehalfOf) {
    headers["onbehalfof"] = session.onBehalfOf;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    const meta = extractUpstreamMeta(response.headers);

    // Handle 200 OK (TIN is valid)
    if (response.status === 200) {
      let name: string | undefined;
      try {
        const responseBody = (await response.json()) as ValidateTinUpstreamResponse;
        name = responseBody.name;
      } catch {
        // Response might be empty or non-JSON
      }

      return {
        ok: true,
        result: {
          valid: true,
          tin,
          name,
          meta,
        },
      };
    }

    // Handle 404 - TIN + ID combination not found (invalid)
    if (response.status === 404) {
      return {
        ok: true,
        result: {
          valid: false,
          tin,
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
          let name: string | undefined;
          try {
            const responseBody = (await retryResponse.json()) as ValidateTinUpstreamResponse;
            name = responseBody.name;
          } catch {
            // Response might be empty
          }

          return {
            ok: true,
            result: {
              valid: true,
              tin,
              name,
              meta: retryMeta,
            },
          };
        }

        if (retryResponse.status === 404) {
          return {
            ok: true,
            result: {
              valid: false,
              tin,
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

    // Handle 400 - Bad request (invalid parameters)
    if (response.status === 400) {
      let message = "Invalid request parameters";
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
): Promise<ValidateTinResponse> {
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
