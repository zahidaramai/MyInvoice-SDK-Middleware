/**
 * In-memory rate limiter using fixed window algorithm
 */

import type { RateLimiter, RateLimitResult } from "./types.js";
import { nowMs, msToSec } from "../time.js";

interface WindowState {
  /** Window start timestamp in ms */
  windowStart: number;
  /** Request count in current window */
  count: number;
}

const WINDOW_SIZE_MS = 60_000; // 1 minute
// P2-13: Cleanup settings to prevent memory leak
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes
const MAX_ENTRIES = 10_000; // Max entries before forced cleanup

/**
 * In-memory rate limiter using fixed window per minute
 */
export class InMemoryRateLimiter implements RateLimiter {
  private windows: Map<string, WindowState> = new Map();
  private lastCleanup: number = nowMs();

  consume(key: string, limitPerMinute: number): RateLimitResult {
    const now = nowMs();

    // P2-13: Periodic cleanup to prevent memory leak
    this.maybeCleanup(now);

    let state = this.windows.get(key);

    // Reset window if expired or doesn't exist
    if (!state || now - state.windowStart >= WINDOW_SIZE_MS) {
      state = { windowStart: now, count: 0 };
      this.windows.set(key, state);
    }

    const windowEnd = state.windowStart + WINDOW_SIZE_MS;
    const retryAfterSeconds = msToSec(windowEnd - now);

    if (state.count >= limitPerMinute) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
        remaining: 0,
        limit: limitPerMinute,
      };
    }

    state.count++;

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: limitPerMinute - state.count,
      limit: limitPerMinute,
    };
  }

  peek(key: string, limitPerMinute: number): RateLimitResult {
    const now = nowMs();
    const state = this.windows.get(key);

    if (!state || now - state.windowStart >= WINDOW_SIZE_MS) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: limitPerMinute,
        limit: limitPerMinute,
      };
    }

    const remaining = Math.max(0, limitPerMinute - state.count);
    const windowEnd = state.windowStart + WINDOW_SIZE_MS;
    const retryAfterSeconds = msToSec(windowEnd - now);

    return {
      allowed: state.count < limitPerMinute,
      retryAfterSeconds: state.count >= limitPerMinute ? Math.max(1, retryAfterSeconds) : 0,
      remaining,
      limit: limitPerMinute,
    };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  /**
   * Clear all stored windows (for testing)
   */
  clear(): void {
    this.windows.clear();
  }

  /**
   * P2-13: Cleanup expired entries to prevent memory leak
   * Called periodically during consume() or can be called manually
   */
  private maybeCleanup(now: number): void {
    // Skip if recently cleaned and under max entries
    if (
      now - this.lastCleanup < CLEANUP_INTERVAL_MS &&
      this.windows.size < MAX_ENTRIES
    ) {
      return;
    }

    this.lastCleanup = now;
    const expireThreshold = now - WINDOW_SIZE_MS;

    // Delete all expired entries
    for (const [key, state] of this.windows) {
      if (state.windowStart < expireThreshold) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Get current number of tracked keys (for monitoring)
   */
  size(): number {
    return this.windows.size;
  }
}

/**
 * Shared singleton instance for use across the application
 */
export const defaultRateLimiter = new InMemoryRateLimiter();
