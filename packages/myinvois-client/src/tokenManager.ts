/**
 * Token Manager - caches tokens and handles refresh
 */

import { isExpired, type RateLimiter } from "@myinvois/core";
import type { SessionCredentials, CachedToken, LoginResult } from "./types.js";
import { login } from "./identity.js";

export interface TokenManagerOptions {
  /** Rate limiter instance */
  rateLimiter?: RateLimiter;
  /** Token renew skew in ms (default 30000) */
  renewSkewMs?: number;
  /** Max cached tokens before cleanup (default 1000) */
  maxCacheSize?: number;
}

// P2-14: Default max cache size to prevent unbounded memory growth
const DEFAULT_MAX_CACHE_SIZE = 1000;

/**
 * Token Manager handles token caching and refresh
 * P0-07: Now includes deduplication for concurrent token refresh requests
 * P2-14: Now includes max cache size and cleanup to prevent unbounded memory growth
 */
export class TokenManager {
  private cache: Map<string, CachedToken> = new Map();
  private rateLimiter?: RateLimiter;
  private renewSkewMs: number;
  private maxCacheSize: number;
  // P0-07: Track in-flight token requests to deduplicate concurrent 401s
  private inFlightRequests: Map<string, Promise<LoginResult>> = new Map();

  constructor(options: TokenManagerOptions = {}) {
    this.rateLimiter = options.rateLimiter;
    this.renewSkewMs = options.renewSkewMs ?? 30_000;
    this.maxCacheSize = options.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
  }

  /**
   * Get a valid token for the session, refreshing if needed
   * P0-07: Deduplicates concurrent refresh requests to prevent wasting login quota
   */
  async getToken(session: SessionCredentials): Promise<LoginResult> {
    const cacheKey = session.sessionId;
    const cached = this.cache.get(cacheKey);

    // Return cached token if still valid
    if (cached && !isExpired(cached.expiresAtMs)) {
      return {
        ok: true,
        token: cached,
        meta: {},
      };
    }

    // P0-07: Check if there's already an in-flight request for this session
    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) {
      // Wait for the existing request instead of making a duplicate
      return inFlight;
    }

    // P0-07: Create and track the login promise
    const loginPromise = this.doLogin(session, cacheKey);
    this.inFlightRequests.set(cacheKey, loginPromise);

    try {
      return await loginPromise;
    } finally {
      // P0-07: Clean up in-flight tracking after completion
      this.inFlightRequests.delete(cacheKey);
    }
  }

  /**
   * P0-07: Internal login helper to separate the actual login from deduplication logic
   */
  private async doLogin(session: SessionCredentials, cacheKey: string): Promise<LoginResult> {
    const result = await login(session, {
      rateLimiter: this.rateLimiter,
      renewSkewMs: this.renewSkewMs,
    });

    if (result.ok) {
      // P2-14: Cleanup expired tokens if cache is getting too large
      if (this.cache.size >= this.maxCacheSize) {
        this.cleanupExpiredTokens();
      }
      this.cache.set(cacheKey, result.token);
    }

    return result;
  }

  /**
   * P2-14: Remove expired tokens from cache to free memory
   */
  private cleanupExpiredTokens(): void {
    for (const [key, token] of this.cache) {
      if (isExpired(token.expiresAtMs)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Force refresh token for a session
   * P0-07: Also deduplicates concurrent refresh requests
   */
  async refreshToken(session: SessionCredentials): Promise<LoginResult> {
    this.cache.delete(session.sessionId);
    return this.getToken(session);
  }

  /**
   * Invalidate cached token for a session
   */
  invalidate(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /**
   * Clear all cached tokens
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Check if a valid token exists for a session
   */
  hasValidToken(sessionId: string): boolean {
    const cached = this.cache.get(sessionId);
    return cached !== undefined && !isExpired(cached.expiresAtMs);
  }

  /**
   * P2-14: Get current cache size (for monitoring)
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Create a new TokenManager instance
 */
export function createTokenManager(options?: TokenManagerOptions): TokenManager {
  return new TokenManager(options);
}
