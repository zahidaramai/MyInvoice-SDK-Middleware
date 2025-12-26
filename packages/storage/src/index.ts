/**
 * @myinvois/storage
 *
 * Persistence adapters for the MyInvois Middleware Gateway:
 * - Prisma + PostgreSQL (production)
 * - SQLite (development)
 *
 * Full implementation will be added in Phase 04+.
 */

export const PACKAGE_NAME = "@myinvois/storage";
export const PACKAGE_VERSION = "0.1.0";

/**
 * Placeholder for future SubmissionRecord type
 */
export interface SubmissionRecord {
  trackingId: string;
  sessionId: string;
  submissionUid: string;
  status: "SUBMITTED" | "PROCESSING" | "VALID" | "INVALID" | "CANCELLED" | "UNKNOWN";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Placeholder for future DocumentRecord type
 */
export interface DocumentRecord {
  trackingId: string;
  codeNumber: string;
  uuid?: string;
  status?: string;
}

/**
 * Get package info
 */
export function getPackageInfo(): { name: string; version: string } {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
  };
}
