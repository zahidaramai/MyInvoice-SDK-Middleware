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

/**
 * In-memory rate limiter using fixed window per minute
 */
export class InMemoryRateLimiter implements RateLimiter {
  private windows: Map<string, WindowState> = new Map();

  consume(key: string, limitPerMinute: number): RateLimitResult {
    const now = nowMs();
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
}

/**
 * Shared singleton instance for use across the application
 */
export const defaultRateLimiter = new InMemoryRateLimiter();
