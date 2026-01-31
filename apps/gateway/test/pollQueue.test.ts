/**
 * TST-16: Poll Queue Tests
 * Tests for BullMQ poll queue functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock BullMQ before importing the module
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
    close: vi.fn().mockResolvedValue(undefined),
    getJobCounts: vi.fn().mockResolvedValue({
      waiting: 5,
      active: 2,
      completed: 100,
      failed: 3,
      delayed: 1,
    }),
    obliterate: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Import after mock
import {
  calculatePollDelay,
  MIN_POLL_INTERVAL_MS,
  POLL_QUEUE_NAME,
} from "../src/lib/pollQueue.js";

describe("TST-16: Poll Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculatePollDelay", () => {
    it("should return delay within valid range", () => {
      const delay = calculatePollDelay();

      // Should be between 3-5 seconds
      expect(delay).toBeGreaterThanOrEqual(MIN_POLL_INTERVAL_MS);
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it("should return different values on multiple calls (randomized)", () => {
      const delays = new Set<number>();

      // Generate 50 delays
      for (let i = 0; i < 50; i++) {
        delays.add(calculatePollDelay());
      }

      // Should have some variation (at least 2 different values)
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe("constants", () => {
    it("should export MIN_POLL_INTERVAL_MS", () => {
      expect(MIN_POLL_INTERVAL_MS).toBe(3000);
    });

    it("should export POLL_QUEUE_NAME", () => {
      expect(POLL_QUEUE_NAME).toBe("poll-submission");
    });
  });

  describe("poll delay timing", () => {
    it("should never return delay less than minimum", () => {
      for (let i = 0; i < 100; i++) {
        const delay = calculatePollDelay();
        expect(delay).toBeGreaterThanOrEqual(MIN_POLL_INTERVAL_MS);
      }
    });
  });
});
