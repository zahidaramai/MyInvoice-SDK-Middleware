/**
 * P2-15: Shared utility for extracting upstream metadata from response headers
 *
 * This function was previously duplicated in:
 * - identity.ts
 * - httpClient.ts
 * - submitDocuments.ts
 */

import type { UpstreamMeta } from "../types.js";

/**
 * Extract upstream metadata from response headers
 * Handles correlation ID and rate limit headers
 */
export function extractUpstreamMeta(headers: Headers): UpstreamMeta {
  const meta: UpstreamMeta = {};

  const correlationId = headers.get("correlationid") || headers.get("x-correlation-id");
  if (correlationId) meta.correlationId = correlationId;

  const limit = headers.get("x-rate-limit-limit");
  if (limit) meta.rateLimitLimit = parseInt(limit, 10);

  const remaining = headers.get("x-rate-limit-remaining");
  if (remaining) meta.rateLimitRemaining = parseInt(remaining, 10);

  const reset = headers.get("x-rate-limit-reset");
  if (reset) meta.rateLimitReset = parseInt(reset, 10);

  return meta;
}
