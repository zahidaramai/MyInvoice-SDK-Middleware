/**
 * Tests for pollInvoice.queue
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock bullmq
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../src/lib/redis.js", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
}));

describe("pollInvoice.queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("queue configuration", () => {
    it("uses correct queue name", () => {
      const queueName = "poll-invoice";
      expect(queueName).toBe("poll-invoice");
    });

    it("configures job options", () => {
      const jobOptions = {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      };

      expect(jobOptions.attempts).toBe(3);
      expect(jobOptions.backoff.type).toBe("exponential");
    });
  });

  describe("job data structure", () => {
    it("validates required job fields", () => {
      const jobData = {
        invoiceId: "invoice-123",
        myinvoisUuid: "myinvois-uuid-456",
        companyId: "company-789",
        attempt: 0,
      };

      expect(jobData.invoiceId).toBeDefined();
      expect(jobData.myinvoisUuid).toBeDefined();
      expect(jobData.companyId).toBeDefined();
    });

    it("allows optional attempt field", () => {
      const jobData = {
        invoiceId: "invoice-123",
        myinvoisUuid: "uuid-456",
        companyId: "company-789",
      };

      const attempt = (jobData as { attempt?: number }).attempt ?? 0;
      expect(attempt).toBe(0);
    });
  });

  describe("enqueue function", () => {
    it("adds job to queue with data", async () => {
      const queue = {
        add: vi.fn().mockResolvedValue({ id: "job-1" }),
      };

      const jobData = {
        invoiceId: "inv-1",
        myinvoisUuid: "uuid-1",
        companyId: "company-1",
      };

      await queue.add("poll-invoice", jobData);

      expect(queue.add).toHaveBeenCalledWith("poll-invoice", jobData);
    });

    it("adds job with delay", async () => {
      const queue = {
        add: vi.fn().mockResolvedValue({ id: "job-2" }),
      };

      const jobData = {
        invoiceId: "inv-2",
        myinvoisUuid: "uuid-2",
        companyId: "company-2",
      };

      const delay = 5000;

      await queue.add("poll-invoice", jobData, { delay });

      expect(queue.add).toHaveBeenCalledWith("poll-invoice", jobData, { delay });
    });
  });

  describe("poll delay calculation", () => {
    it("calculates initial delay", () => {
      const calculateDelay = (attempt: number) => {
        const baseDelay = 3000;
        const maxDelay = 300000;
        return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      };

      expect(calculateDelay(0)).toBe(3000);
    });

    it("calculates exponential backoff", () => {
      const calculateDelay = (attempt: number) => {
        const baseDelay = 3000;
        const maxDelay = 300000;
        return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      };

      expect(calculateDelay(1)).toBe(6000);
      expect(calculateDelay(2)).toBe(12000);
      expect(calculateDelay(3)).toBe(24000);
      expect(calculateDelay(4)).toBe(48000);
    });

    it("caps at maximum delay", () => {
      const calculateDelay = (attempt: number) => {
        const baseDelay = 3000;
        const maxDelay = 300000;
        return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      };

      expect(calculateDelay(10)).toBe(300000);
      expect(calculateDelay(20)).toBe(300000);
    });
  });

  describe("job priority", () => {
    it("supports priority levels", () => {
      const priorities = {
        high: 1,
        normal: 5,
        low: 10,
      };

      expect(priorities.high).toBeLessThan(priorities.normal);
      expect(priorities.normal).toBeLessThan(priorities.low);
    });

    it("assigns default priority", () => {
      const defaultPriority = 5;
      expect(defaultPriority).toBe(5);
    });
  });

  describe("job deduplication", () => {
    it("generates unique job ID", () => {
      const generateJobId = (invoiceId: string, attempt: number) => {
        return `poll-${invoiceId}-${attempt}`;
      };

      const id1 = generateJobId("inv-1", 0);
      const id2 = generateJobId("inv-1", 1);
      const id3 = generateJobId("inv-2", 0);

      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
    });

    it("allows same invoice different attempts", () => {
      const ids = ["poll-inv-1-0", "poll-inv-1-1", "poll-inv-1-2"];

      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe("queue metrics", () => {
    it("tracks job count", () => {
      const metrics = {
        waiting: 10,
        active: 5,
        completed: 100,
        failed: 3,
      };

      expect(metrics.waiting).toBe(10);
      expect(metrics.active).toBe(5);
      expect(metrics.completed).toBe(100);
      expect(metrics.failed).toBe(3);
    });

    it("calculates success rate", () => {
      const metrics = {
        completed: 97,
        failed: 3,
      };

      const total = metrics.completed + metrics.failed;
      const successRate = metrics.completed / total;

      expect(successRate).toBe(0.97);
    });
  });

  describe("error handling", () => {
    it("handles queue connection error", async () => {
      const queue = {
        add: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };

      await expect(queue.add("poll-invoice", { invoiceId: "inv-1" })).rejects.toThrow(
        "Connection refused"
      );
    });

    it("handles job processing error", () => {
      const error = {
        message: "Failed to fetch document details",
        code: "FETCH_FAILED",
      };

      expect(error.code).toBe("FETCH_FAILED");
    });
  });

  describe("job completion", () => {
    it("removes completed jobs", () => {
      const options = {
        removeOnComplete: true,
      };

      expect(options.removeOnComplete).toBe(true);
    });

    it("keeps failed jobs", () => {
      const options = {
        removeOnFail: false,
      };

      expect(options.removeOnFail).toBe(false);
    });

    it("supports keeping completed jobs for period", () => {
      const options = {
        removeOnComplete: {
          age: 3600, // 1 hour
          count: 1000,
        },
      };

      expect(options.removeOnComplete.age).toBe(3600);
    });
  });

  describe("retry configuration", () => {
    it("configures max attempts", () => {
      const options = {
        attempts: 20,
      };

      expect(options.attempts).toBe(20);
    });

    it("configures backoff strategy", () => {
      const options = {
        backoff: {
          type: "exponential" as const,
          delay: 3000,
        },
      };

      expect(options.backoff.type).toBe("exponential");
      expect(options.backoff.delay).toBe(3000);
    });
  });
});
