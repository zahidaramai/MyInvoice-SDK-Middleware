/**
 * MyInvois HTTP Client - wraps requests with auth and rate limiting
 *
 * Features:
 * - Timeouts via AbortController
 * - Retry policy for idempotent GETs (network/5xx errors)
 * - 401 refresh + single retry
 * - 429 rate limit handling (no auto-retry)
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
import { extractUpstreamMeta } from "./utils/extractUpstreamMeta.js";

const DEFAULT_RETRY_AFTER = 60;

/**
 * Timeout configuration in milliseconds
 */
export interface TimeoutConfig {
  /** Timeout for token/login requests (default: 10s) */
  token: number;
  /** Timeout for idempotent GET requests (default: 15s) */
  get: number;
  /** Timeout for POST/PUT/DELETE requests (default: 20s) */
  post: number;
}

const DEFAULT_TIMEOUTS: TimeoutConfig = {
  token: parseInt(process.env.UPSTREAM_TIMEOUT_TOKEN_MS || "10000", 10),
  get: parseInt(process.env.UPSTREAM_TIMEOUT_GET_MS || "15000", 10),
  post: parseInt(process.env.UPSTREAM_TIMEOUT_POST_MS || "20000", 10),
};

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Max retries for idempotent GET requests (default: 2) */
  maxRetries: number;
  /** Initial backoff delay in ms (default: 250) */
  initialBackoffMs: number;
  /** Backoff multiplier (default: 3) */
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: parseInt(process.env.GET_RETRY_MAX || "2", 10),
  initialBackoffMs: 250,
  backoffMultiplier: 3,
};

/**
 * Metrics callback hooks for observability
 */
export interface MetricsHooks {
  onUpstreamRequestStart?: (endpoint: string, method: string) => void;
  onUpstreamRequestEnd?: (endpoint: string, method: string, status: number, durationMs: number) => void;
  onUpstreamRateLimited?: (endpoint: string) => void;
  onTokenCacheHit?: () => void;
  onTokenCacheMiss?: () => void;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is retriable (network error or 5xx)
 */
function isRetriableError(status: number): boolean {
  return status === 0 || (status >= 500 && status < 600);
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
  /** Timeout configuration (optional, uses defaults) */
  timeouts?: Partial<TimeoutConfig>;
  /** Retry configuration (optional, uses defaults) */
  retry?: Partial<RetryConfig>;
  /** Metrics hooks for observability */
  metricsHooks?: MetricsHooks;
}

/**
 * MyInvois HTTP Client
 */
export class MyInvoisHttpClient {
  private tokenManager: TokenManager;
  private timeouts: TimeoutConfig;
  private retry: RetryConfig;
  private metricsHooks?: MetricsHooks;

  constructor(options: HttpClientOptions) {
    this.tokenManager = options.tokenManager;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.retry = { ...DEFAULT_RETRY_CONFIG, ...options.retry };
    this.metricsHooks = options.metricsHooks;
  }

  /**
   * Get timeout for a request method
   */
  private getTimeout(method: string): number {
    if (method === "GET") return this.timeouts.get;
    return this.timeouts.post;
  }

  /**
   * Create AbortController with timeout
   */
  private createTimeoutController(timeoutMs: number): { controller: AbortController; timeoutId: NodeJS.Timeout } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return { controller, timeoutId };
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
    const timeout = this.getTimeout(method);
    const isIdempotent = method === "GET";
    const endpoint = path.split("?")[0]; // Remove query params for metrics

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

    // Execute request with retry logic for idempotent GETs
    let lastError: MyInvoisResponse<T> | null = null;
    const maxAttempts = isIdempotent ? this.retry.maxRetries + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Wait before retry (exponential backoff)
      if (attempt > 0) {
        const backoffMs = this.retry.initialBackoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
        await sleep(backoffMs);
      }

      const result = await this.executeRequest<T>(
        url,
        method,
        headers,
        body,
        timeout,
        session,
        authRequired,
        endpoint
      );

      // Return immediately on success
      if (result.ok) {
        return result;
      }

      // Return immediately on 429 - never auto-retry rate limits
      if (result.status === 429) {
        this.metricsHooks?.onUpstreamRateLimited?.(endpoint);
        return result;
      }

      // Return immediately on 4xx client errors (except 401 which is handled in executeRequest)
      if (result.status >= 400 && result.status < 500 && result.status !== 401) {
        return result;
      }

      // Store error for retry
      lastError = result;

      // Only retry if error is retriable (network/5xx) and request is idempotent
      if (!isIdempotent || !isRetriableError(result.status)) {
        return result;
      }
    }

    // Return last error if all retries failed
    return lastError!;
  }

  /**
   * Execute a single HTTP request with timeout
   */
  private async executeRequest<T>(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: unknown,
    timeout: number,
    session: SessionCredentials,
    authRequired: boolean,
    endpoint: string
  ): Promise<MyInvoisResponse<T>> {
    const { controller, timeoutId } = this.createTimeoutController(timeout);
    const startTime = performance.now();

    this.metricsHooks?.onUpstreamRequestStart?.(endpoint, method);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const durationMs = performance.now() - startTime;
      const meta = extractUpstreamMeta(response.headers);

      this.metricsHooks?.onUpstreamRequestEnd?.(endpoint, method, response.status, durationMs);

      // Handle 401 - try refresh token once
      if (response.status === 401 && authRequired) {
        const refreshResult = await this.tokenManager.refreshToken(session);
        if (refreshResult.ok) {
          // Retry with new token (single retry, new timeout)
          const { controller: retryController, timeoutId: retryTimeoutId } = this.createTimeoutController(timeout);
          const retryHeaders = { ...headers };
          retryHeaders["Authorization"] = `Bearer ${refreshResult.token.accessToken}`;

          const retryStartTime = performance.now();
          this.metricsHooks?.onUpstreamRequestStart?.(endpoint, method);

          try {
            const retryResponse = await fetch(url, {
              method,
              headers: retryHeaders,
              body: body ? JSON.stringify(body) : undefined,
              signal: retryController.signal,
            });

            clearTimeout(retryTimeoutId);
            const retryDurationMs = performance.now() - retryStartTime;
            const retryMeta = extractUpstreamMeta(retryResponse.headers);

            this.metricsHooks?.onUpstreamRequestEnd?.(endpoint, method, retryResponse.status, retryDurationMs);

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
          } catch (retryError) {
            clearTimeout(retryTimeoutId);
            const retryDurationMs = performance.now() - retryStartTime;
            this.metricsHooks?.onUpstreamRequestEnd?.(endpoint, method, 0, retryDurationMs);
            return this.buildNetworkErrorResponse<T>(retryError);
          }
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
      clearTimeout(timeoutId);
      const durationMs = performance.now() - startTime;
      this.metricsHooks?.onUpstreamRequestEnd?.(endpoint, method, 0, durationMs);
      return this.buildNetworkErrorResponse<T>(error);
    }
  }

  /**
   * Build network error response
   */
  private buildNetworkErrorResponse<T>(error: unknown): MyInvoisResponse<T> {
    let message = "Network error";
    let code = "NETWORK_ERROR";

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        message = "Request timed out";
        code = "TIMEOUT_ERROR";
      } else {
        message = error.message;
      }
    }

    return {
      ok: false,
      status: 0,
      error: {
        status: 0,
        message,
        code,
      },
      meta: {},
    };
  }

  private async buildErrorResponse<T>(
    response: Response,
    meta: UpstreamMeta
  ): Promise<MyInvoisResponse<T>> {
    let message = `Request failed with status ${response.status}`;
    let code = "UPSTREAM_ERROR";
    let details: Array<{ code?: string; message?: string; target?: string; propertyName?: string; propertyPath?: string }> | undefined;

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

      // MYI-13: Extract additional error details for debugging
      details = [];

      // Include base error info if it has property details
      if (errorBody.propertyName || errorBody.propertyPath || errorBody.target) {
        details.push({
          code: typeof errorBody.code === "string" ? errorBody.code : undefined,
          message: typeof errorBody.message === "string" ? errorBody.message : undefined,
          target: typeof errorBody.target === "string" ? errorBody.target : undefined,
          propertyName: typeof errorBody.propertyName === "string" ? errorBody.propertyName : undefined,
          propertyPath: typeof errorBody.propertyPath === "string" ? errorBody.propertyPath : undefined,
        });
      }

      // Include nested details array
      if (Array.isArray(errorBody.details)) {
        for (const detail of errorBody.details) {
          if (detail && typeof detail === "object") {
            details.push({
              code: typeof detail.code === "string" ? detail.code : undefined,
              message: typeof detail.message === "string" ? detail.message : undefined,
              target: typeof detail.target === "string" ? detail.target : undefined,
              propertyName: typeof detail.propertyName === "string" ? detail.propertyName : undefined,
              propertyPath: typeof detail.propertyPath === "string" ? detail.propertyPath : undefined,
            });
          }
        }
      }

      // Include innerError array
      if (Array.isArray(errorBody.innerError)) {
        for (const inner of errorBody.innerError) {
          if (inner && typeof inner === "object") {
            details.push({
              code: typeof inner.code === "string" ? inner.code : undefined,
              message: typeof inner.message === "string" ? inner.message : undefined,
              target: typeof inner.target === "string" ? inner.target : undefined,
              propertyName: typeof inner.propertyName === "string" ? inner.propertyName : undefined,
              propertyPath: typeof inner.propertyPath === "string" ? inner.propertyPath : undefined,
            });
          }
        }
      }

      // Only include details if we found any
      if (details.length === 0) {
        details = undefined;
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
        details,
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
