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
}

/**
 * Token Manager handles token caching and refresh
 */
export class TokenManager {
  private cache: Map<string, CachedToken> = new Map();
  private rateLimiter?: RateLimiter;
  private renewSkewMs: number;

  constructor(options: TokenManagerOptions = {}) {
    this.rateLimiter = options.rateLimiter;
    this.renewSkewMs = options.renewSkewMs ?? 30_000;
  }

  /**
   * Get a valid token for the session, refreshing if needed
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

    // Fetch new token
    const result = await login(session, {
      rateLimiter: this.rateLimiter,
      renewSkewMs: this.renewSkewMs,
    });

    if (result.ok) {
      this.cache.set(cacheKey, result.token);
    }

    return result;
  }

  /**
   * Force refresh token for a session
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
}

/**
 * Create a new TokenManager instance
 */
export function createTokenManager(options?: TokenManagerOptions): TokenManager {
  return new TokenManager(options);
}
