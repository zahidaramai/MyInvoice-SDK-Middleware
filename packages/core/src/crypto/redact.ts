/**
 * Redaction helpers for logging sensitive data
 */

const REDACTED = "[REDACTED]";
const PARTIAL_VISIBLE_CHARS = 4;

/**
 * Fully redact a value
 */
export function redact(_value: unknown): string {
  return REDACTED;
}

/**
 * Partially redact a string, showing first N chars
 */
export function redactPartial(value: string, visibleChars = PARTIAL_VISIBLE_CHARS): string {
  if (value.length <= visibleChars) {
    return REDACTED;
  }
  return value.slice(0, visibleChars) + "..." + REDACTED;
}

/**
 * Redact sensitive fields from an object (shallow)
 */
export function redactObject<T extends Record<string, unknown>>(
  obj: T,
  sensitiveFields: string[]
): T {
  const result = { ...obj };
  for (const field of sensitiveFields) {
    if (field in result) {
      result[field as keyof T] = REDACTED as T[keyof T];
    }
  }
  return result;
}

/**
 * Known sensitive field names
 */
export const SENSITIVE_FIELDS = [
  "clientSecret",
  "client_secret",
  "accessToken",
  "access_token",
  "token",
  "password",
  "secret",
  "authorization",
] as const;

/**
 * Redact known sensitive fields from an object
 */
export function redactSensitive<T extends Record<string, unknown>>(obj: T): T {
  return redactObject(obj, [...SENSITIVE_FIELDS]);
}
