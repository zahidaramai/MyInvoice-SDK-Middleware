/**
 * @myinvois/myinvois-client
 *
 * Typed client for MyInvois upstream API:
 * - OAuth token management
 * - HTTP client with retries
 * - Rate limiting support
 * - UBL 2.1 document builders
 * - MyInvois codes and enums
 */

export const PACKAGE_NAME = "@myinvois/myinvois-client";
export const PACKAGE_VERSION = "0.1.0";

// Types
export * from "./types.js";

// Rate limits
export * from "./rateLimits.js";

// MyInvois Codes and Enums
export * from "./codes.js";

// Identity (login)
export { login } from "./identity.js";
export type { LoginOptions } from "./identity.js";

// Token Manager
export { TokenManager, createTokenManager } from "./tokenManager.js";
export type { TokenManagerOptions } from "./tokenManager.js";

// HTTP Client
export { MyInvoisHttpClient, createHttpClient } from "./httpClient.js";
export type { HttpClientOptions, TimeoutConfig, RetryConfig, MetricsHooks } from "./httpClient.js";

// e-Invoice API
export * from "./einvoice/index.js";

// Taxpayer API
export * from "./taxpayer/index.js";

// UBL Document Builders
export * from "./ubl/index.js";

// Error Normalizer
export * from "./error-normalizer.js";

/**
 * Get package info
 */
export function getPackageInfo(): { name: string; version: string } {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
  };
}
