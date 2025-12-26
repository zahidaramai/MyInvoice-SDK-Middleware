/**
 * Time utilities for consistent time handling
 */

/**
 * Get current timestamp in milliseconds
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Get current timestamp in seconds
 */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Convert seconds to milliseconds
 */
export function secToMs(seconds: number): number {
  return seconds * 1000;
}

/**
 * Convert milliseconds to seconds
 */
export function msToSec(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Calculate expiry timestamp from expires_in seconds
 */
export function expiresAtFromExpiresIn(expiresInSec: number, skewMs = 0): number {
  return nowMs() + secToMs(expiresInSec) - skewMs;
}

/**
 * Check if a timestamp (ms) is expired
 */
export function isExpired(expiresAtMs: number): boolean {
  return nowMs() >= expiresAtMs;
}
