/**
 * MyInvois client wiring for the gateway
 */

import { createTokenManager, type TokenManager } from "@myinvois/myinvois-client";
import { InMemoryRateLimiter, type RateLimiter } from "@myinvois/core";

let tokenManagerInstance: TokenManager | undefined;
let rateLimiterInstance: RateLimiter | undefined;

/**
 * Get or create the rate limiter instance
 */
export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new InMemoryRateLimiter();
  }
  return rateLimiterInstance;
}

/**
 * Get or create the token manager instance
 */
export function getTokenManager(): TokenManager {
  if (!tokenManagerInstance) {
    const renewSkewMs = parseInt(process.env.TOKEN_RENEW_SKEW_MS || "30000", 10);
    tokenManagerInstance = createTokenManager({
      rateLimiter: getRateLimiter(),
      renewSkewMs,
    });
  }
  return tokenManagerInstance;
}

/**
 * Reset instances (for testing)
 */
export function resetInstances(): void {
  tokenManagerInstance?.clear();
  tokenManagerInstance = undefined;
  if (rateLimiterInstance instanceof InMemoryRateLimiter) {
    rateLimiterInstance.clear();
  }
  rateLimiterInstance = undefined;
}
