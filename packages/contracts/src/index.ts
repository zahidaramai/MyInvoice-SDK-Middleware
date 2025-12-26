/**
 * @myinvois/contracts
 *
 * Shared type contracts and Zod schemas for the MyInvois Middleware Gateway.
 * These will be used for runtime validation and OpenAPI alignment.
 *
 * Full implementation will be added in Phase 01+.
 */

export const PACKAGE_NAME = "@myinvois/contracts";
export const PACKAGE_VERSION = "0.1.0";

/**
 * Gateway error shape (stable contract)
 */
export interface GatewayError {
  correlationId?: string;
  httpStatus: number;
  errorCode?: string;
  propertyName?: string | null;
  propertyPath?: string | null;
  target?: string | null;
  messageEN: string;
  messageMS?: string;
  inner?: GatewayError[];
  retryAfterSeconds?: number;
  upstream?: {
    service: "MYINVOIS";
    path: string;
    method?: string;
    status?: number;
  };
}

/**
 * Error envelope wrapper
 */
export interface ErrorEnvelope {
  error: GatewayError;
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
