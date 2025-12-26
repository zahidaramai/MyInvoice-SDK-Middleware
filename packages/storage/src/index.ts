/**
 * @myinvois/storage
 *
 * Persistence adapters for the MyInvois Middleware Gateway:
 * - Prisma + PostgreSQL (production)
 * - SQLite (development)
 */

export const PACKAGE_NAME = "@myinvois/storage";
export const PACKAGE_VERSION = "0.1.0";

// Prisma client
export * from "./prisma.js";

// Types
export * from "./types.js";

// Repositories
export * from "./repositories/index.js";

/**
 * Get package info
 */
export function getPackageInfo(): { name: string; version: string } {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
  };
}
