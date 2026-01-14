/**
 * Shared Validation Helpers
 *
 * Common validation functions used across route handlers.
 */

/**
 * Validate session ID format (sess_[a-zA-Z0-9]+)
 */
export function isValidSessionId(id: string): boolean {
  return /^sess_[a-zA-Z0-9]+$/.test(id);
}

/**
 * Validate UUID format (8-4-4-4-12 hex format)
 */
export function isValidUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}
