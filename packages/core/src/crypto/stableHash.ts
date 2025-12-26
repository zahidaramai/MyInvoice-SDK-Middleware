/**
 * Stable hashing utilities for fingerprinting
 */

import { createHash } from "node:crypto";

/**
 * Generate a stable SHA-256 hash of the input
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Generate a truncated hash (first N characters)
 */
export function sha256Short(input: string, length = 12): string {
  return sha256(input).slice(0, length);
}

/**
 * Generate a session fingerprint from key components
 * Used for logging and correlation without exposing secrets
 */
export function sessionFingerprint(
  env: string,
  mode: string,
  clientId: string,
  onBehalfOf?: string
): string {
  const components = [env, mode, clientId, onBehalfOf ?? ""].join(":");
  return sha256Short(components);
}
