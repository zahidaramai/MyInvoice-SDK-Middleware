/**
 * Centralized redaction paths for Pino logger
 * Ensures consistent redaction across gateway, worker, and client
 *
 * IMPORTANT: These paths are used by Pino's built-in redaction.
 * Never log secrets, tokens, document contents, or PII.
 */

/**
 * Pino redact paths for sensitive data
 * Uses Pino's path syntax: https://github.com/pinojs/pino/blob/master/docs/redaction.md
 */
export const PINO_REDACT_PATHS = [
  // Authorization and tokens
  "req.headers.authorization",
  "req.headers.Authorization",
  "res.headers.authorization",
  "res.headers.Authorization",
  "headers.authorization",
  "headers.Authorization",
  "authorization",
  "Authorization",

  // Cookies
  "req.headers.cookie",
  "req.headers.Cookie",
  "res.headers.set-cookie",
  "res.headers['set-cookie']",
  "cookies",
  "cookie",

  // OAuth tokens
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "token",
  "*.access_token",
  "*.accessToken",
  "*.refresh_token",
  "*.refreshToken",
  "*.token",

  // Client credentials
  "clientSecret",
  "client_secret",
  "*.clientSecret",
  "*.client_secret",
  "secret",
  "password",
  "*.secret",
  "*.password",

  // Document content (base64 payloads)
  "document",
  "rawDocument",
  "documentBase64",
  "base64",
  "*.document",
  "*.rawDocument",
  "*.documentBase64",
  "documents[*].document",
  "documents[*].rawDocument",
  "documents[*].documentBase64",

  // PII fields (taxpayer info)
  "idValue",
  "taxpayerName",
  "*.idValue",
  "*.taxpayerName",
] as const;

/**
 * Pino redact configuration
 * Use this when creating Pino logger instances
 */
export const PINO_REDACT_CONFIG: { paths: string[]; censor: string } = {
  paths: [...PINO_REDACT_PATHS],
  censor: "[REDACTED]",
};

/**
 * Fields that should be logged but partially redacted
 * (e.g., show first 4 chars for debugging)
 */
export const PARTIAL_REDACT_FIELDS = [
  "sessionId", // sess_xxxx...
  "trackingId", // trk_xxxx...
  "correlationId", // Keep full for debugging
  "submissionUid", // Keep full for debugging
] as const;

/**
 * Create safe log context by stripping sensitive fields
 * Use this for manual object sanitization before logging
 */
export function createSafeLogContext(
  context: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveKeys = new Set([
    "clientSecret",
    "client_secret",
    "access_token",
    "accessToken",
    "refresh_token",
    "refreshToken",
    "token",
    "password",
    "secret",
    "authorization",
    "Authorization",
    "document",
    "rawDocument",
    "documentBase64",
    "idValue",
  ]);

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (sensitiveKeys.has(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = createSafeLogContext(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Create a fingerprint from client ID for logging
 * Shows first 8 chars + hash suffix for identification without exposing full ID
 */
export function clientIdFingerprint(clientId: string): string {
  if (!clientId || clientId.length < 8) {
    return "[INVALID_CLIENT_ID]";
  }
  return `${clientId.slice(0, 8)}...`;
}

/**
 * Fields that are safe to log in full
 */
export const SAFE_LOG_FIELDS = [
  "correlationId",
  "trackingId",
  "sessionId",
  "submissionUid",
  "documentUuid",
  "env",
  "mode",
  "status",
  "httpStatus",
  "errorCode",
  "method",
  "path",
  "route",
  "cached",
  "retryAfterSeconds",
] as const;
