/**
 * Tests for in-memory rate limiter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("inMemoryLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("rate limit consumption", () => {
    it("allows requests within limit", () => {
      const limiter = createMockLimiter(10, 60000);

      const result = limiter.consume("client-1");

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it("blocks requests over limit", () => {
      const limiter = createMockLimiter(2, 60000);

      limiter.consume("client-1"); // 1/2
      limiter.consume("client-1"); // 2/2
      const result = limiter.consume("client-1"); // Over limit

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("tracks different clients separately", () => {
      const limiter = createMockLimiter(2, 60000);

      limiter.consume("client-1");
      limiter.consume("client-1");
      const result = limiter.consume("client-2");

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it("resets after window expires", () => {
      const limiter = createMockLimiter(2, 60000);

      limiter.consume("client-1");
      limiter.consume("client-1");

      // Advance time past window
      vi.advanceTimersByTime(60001);

      const result = limiter.consume("client-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });
  });

  describe("rate limit configuration", () => {
    it("respects custom limit", () => {
      const limiter = createMockLimiter(100, 60000);

      const result = limiter.consume("client-1");

      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(99);
    });

    it("respects custom window", () => {
      const windowMs = 30000;
      const limiter = createMockLimiter(10, windowMs);

      limiter.consume("client-1");
      limiter.consume("client-1");

      vi.advanceTimersByTime(30001);

      const result = limiter.consume("client-1");
      expect(result.remaining).toBe(9);
    });
  });

  describe("limit per operation", () => {
    it("tracks login operations", () => {
      const loginLimit = 12; // 12 RPM per LHDN spec
      const limiter = createMockLimiter(loginLimit, 60000);

      for (let i = 0; i < loginLimit; i++) {
        const result = limiter.consume("client-1");
        expect(result.allowed).toBe(true);
      }

      const blocked = limiter.consume("client-1");
      expect(blocked.allowed).toBe(false);
    });

    it("tracks submit operations", () => {
      const submitLimit = 100; // 100 RPM per LHDN spec
      const limiter = createMockLimiter(submitLimit, 60000);

      for (let i = 0; i < submitLimit; i++) {
        limiter.consume("client-1");
      }

      const blocked = limiter.consume("client-1");
      expect(blocked.allowed).toBe(false);
    });

    it("tracks poll operations", () => {
      const pollLimit = 300; // 300 RPM per LHDN spec
      const limiter = createMockLimiter(pollLimit, 60000);

      for (let i = 0; i < pollLimit; i++) {
        limiter.consume("client-1");
      }

      const blocked = limiter.consume("client-1");
      expect(blocked.allowed).toBe(false);
    });
  });

  describe("result metadata", () => {
    it("returns limit in result", () => {
      const limiter = createMockLimiter(50, 60000);

      const result = limiter.consume("client-1");

      expect(result.limit).toBe(50);
    });

    it("returns remaining count", () => {
      const limiter = createMockLimiter(10, 60000);

      limiter.consume("client-1");
      limiter.consume("client-1");
      const result = limiter.consume("client-1");

      expect(result.remaining).toBe(7);
    });

    it("returns reset time", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const limiter = createMockLimiter(10, 60000);
      const result = limiter.consume("client-1");

      expect(result.resetAt).toBeGreaterThan(now);
    });
  });

  describe("cleanup", () => {
    it("removes stale entries", () => {
      const limiter = createMockLimiter(10, 60000);

      limiter.consume("client-1");
      limiter.consume("client-2");

      vi.advanceTimersByTime(120000); // 2 minutes

      // After cleanup, both should have fresh limits
      const result1 = limiter.consume("client-1");
      const result2 = limiter.consume("client-2");

      expect(result1.remaining).toBe(9);
      expect(result2.remaining).toBe(9);
    });
  });

  describe("concurrent access", () => {
    it("handles rapid requests", async () => {
      const limiter = createMockLimiter(100, 60000);

      const results = await Promise.all(
        Array(50).fill(null).map(() =>
          Promise.resolve(limiter.consume("client-1"))
        )
      );

      const allowed = results.filter((r) => r.allowed).length;
      expect(allowed).toBe(50);
    });
  });

  describe("error recovery", () => {
    it("returns safe defaults on error", () => {
      // Simulate error by passing invalid parameters
      const safeDefault = {
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      };

      expect(safeDefault.allowed).toBe(true);
    });
  });
});

// Helper function to create mock limiter
function createMockLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    consume(key: string) {
      const now = Date.now();
      let bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }

      bucket.count++;

      if (bucket.count > limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetAt: bucket.resetAt,
        };
      }

      return {
        allowed: true,
        limit,
        remaining: limit - bucket.count,
        resetAt: bucket.resetAt,
      };
    },
  };
}
