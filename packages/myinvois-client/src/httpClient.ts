/**
 * MyInvois HTTP Client - wraps requests with auth and rate limiting
 */

import { resolveSystemBaseUrl } from "@myinvois/core";
import type {
  SessionCredentials,
  RequestOptions,
  MyInvoisResponse,
  UpstreamMeta,
  UpstreamError,
} from "./types.js";
import { TokenManager } from "./tokenManager.js";

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
 * Calculate retry-after seconds from response
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

export interface HttpClientOptions {
  /** Token manager instance */
  tokenManager: TokenManager;
}

/**
 * MyInvois HTTP Client
 */
export class MyInvoisHttpClient {
  private tokenManager: TokenManager;

  constructor(options: HttpClientOptions) {
    this.tokenManager = options.tokenManager;
  }

  /**
   * Make an HTTP request to the MyInvois API
   */
  async request<T>(
    session: SessionCredentials,
    options: RequestOptions
  ): Promise<MyInvoisResponse<T>> {
    const { method, path, authRequired = true, headers: extraHeaders, body } = options;

    const baseUrl = resolveSystemBaseUrl(session.env);
    const url = `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      ...extraHeaders,
    };

    // Get auth token if required
    if (authRequired) {
      const tokenResult = await this.tokenManager.getToken(session);
      if (!tokenResult.ok) {
        return {
          ok: false,
          status: tokenResult.error.status,
          error: tokenResult.error,
          meta: tokenResult.error.meta || {},
        };
      }
      headers["Authorization"] = `Bearer ${tokenResult.token.accessToken}`;
    }

    // Set content-type for body
    if (body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const meta = extractUpstreamMeta(response.headers);

      // Handle 401 - try refresh token once
      if (response.status === 401 && authRequired) {
        const refreshResult = await this.tokenManager.refreshToken(session);
        if (refreshResult.ok) {
          // Retry with new token
          headers["Authorization"] = `Bearer ${refreshResult.token.accessToken}`;
          const retryResponse = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });

          const retryMeta = extractUpstreamMeta(retryResponse.headers);

          if (!retryResponse.ok) {
            return this.buildErrorResponse<T>(retryResponse, retryMeta);
          }

          const retryData = retryResponse.status !== 204 ? (await retryResponse.json()) as T : undefined;
          return {
            ok: true,
            status: retryResponse.status,
            data: retryData,
            meta: retryMeta,
          };
        }
      }

      // Handle 429 - rate limit exceeded
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
        return {
          ok: false,
          status: 429,
          error,
          meta,
        };
      }

      if (!response.ok) {
        return this.buildErrorResponse<T>(response, meta);
      }

      const data = response.status !== 204 ? (await response.json()) as T : undefined;
      return {
        ok: true,
        status: response.status,
        data,
        meta,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      return {
        ok: false,
        status: 0,
        error: {
          status: 0,
          message,
          code: "NETWORK_ERROR",
        },
        meta: {},
      };
    }
  }

  private async buildErrorResponse<T>(
    response: Response,
    meta: UpstreamMeta
  ): Promise<MyInvoisResponse<T>> {
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
      status: response.status,
      error: {
        status: response.status,
        message,
        code,
        meta,
      },
      meta,
    };
  }
}

/**
 * Create a new HTTP client instance
 */
export function createHttpClient(options: HttpClientOptions): MyInvoisHttpClient {
  return new MyInvoisHttpClient(options);
}
