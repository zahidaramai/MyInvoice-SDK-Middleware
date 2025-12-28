/**
 * @myinvois/core
 *
 * Core utilities for the MyInvois Middleware Gateway:
 * - Environment configuration
 * - Rate limiting
 * - Crypto helpers (redaction, hashing)
 * - Time utilities
 * - Observability (metrics, logging redaction)
 */

export const PACKAGE_NAME = "@myinvois/core";
export const PACKAGE_VERSION = "0.1.0";

// Environment
export * from "./env.js";

// Time utilities
export * from "./time.js";

// Rate limiting
export * from "./rateLimit/index.js";

// Crypto helpers
export * from "./crypto/index.js";

// Observability (metrics + redaction)
export * from "./observability/index.js";

// Error handling
export * from "./errors/index.js";

/**
 * Get package info
 */
export function getPackageInfo(): { name: string; version: string } {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
  };
}
