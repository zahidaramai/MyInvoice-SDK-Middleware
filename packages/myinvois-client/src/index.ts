/**
 * @myinvois/myinvois-client
 *
 * Typed client for MyInvois upstream API:
 * - OAuth token management
 * - HTTP client with retries
 * - Rate limiting support
 */

export const PACKAGE_NAME = "@myinvois/myinvois-client";
export const PACKAGE_VERSION = "0.1.0";

// Types
export * from "./types.js";

// Rate limits
export * from "./rateLimits.js";

// Identity (login)
export { login } from "./identity.js";
export type { LoginOptions } from "./identity.js";

// Token Manager
export { TokenManager, createTokenManager } from "./tokenManager.js";
export type { TokenManagerOptions } from "./tokenManager.js";

// HTTP Client
export { MyInvoisHttpClient, createHttpClient } from "./httpClient.js";
export type { HttpClientOptions } from "./httpClient.js";

/**
 * Get package info
 */
export function getPackageInfo(): { name: string; version: string } {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
  };
}
