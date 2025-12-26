/**
 * Rate limiter interface and types
 */

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Seconds until the client can retry (0 if allowed) */
  retryAfterSeconds: number;
  /** Remaining requests in the current window */
  remaining: number;
  /** Total limit per window */
  limit: number;
}

/**
 * Generic rate limiter interface - can be backed by memory, Redis, etc.
 */
export interface RateLimiter {
  /**
   * Attempt to consume a request for the given key
   * @param key - Unique identifier (e.g., clientId, sessionId)
   * @param limitPerMinute - Maximum requests allowed per minute
   * @returns Result indicating if allowed and retry info
   */
  consume(key: string, limitPerMinute: number): RateLimitResult;

  /**
   * Reset the rate limit for a key (for testing or manual override)
   */
  reset(key: string): void;

  /**
   * Get current state without consuming
   */
  peek(key: string, limitPerMinute: number): RateLimitResult;
}
