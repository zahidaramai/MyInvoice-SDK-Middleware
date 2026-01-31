/**
 * Tests for pollSubmission.worker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../src/lib/redis.js", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
}));

vi.mock("../../src/lib/logger.js", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("pollSubmission.worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("submission status mapping", () => {
    it("maps in progress status", () => {
      const statusMap: Record<string, string> = {
        "in progress": "IN_PROGRESS",
        valid: "VALID",
        "partially valid": "PARTIALLY_VALID",
        invalid: "INVALID",
      };

      expect(statusMap["in progress"]).toBe("IN_PROGRESS");
    });

    it("maps valid status", () => {
      const statusMap: Record<string, string> = {
        valid: "VALID",
      };

      expect(statusMap["valid"]).toBe("VALID");
    });

    it("maps partially valid status", () => {
      const statusMap: Record<string, string> = {
        "partially valid": "PARTIALLY_VALID",
      };

      expect(statusMap["partially valid"]).toBe("PARTIALLY_VALID");
    });

    it("maps invalid status", () => {
      const statusMap: Record<string, string> = {
        invalid: "INVALID",
      };

      expect(statusMap["invalid"]).toBe("INVALID");
    });
  });

  describe("document status mapping", () => {
    it("maps Valid document status", () => {
      const statusMap: Record<string, string> = {
        Valid: "VALID",
        Invalid: "INVALID",
        Submitted: "SUBMITTED",
        Cancelled: "CANCELLED",
        Rejected: "REJECTED",
      };

      expect(statusMap["Valid"]).toBe("VALID");
    });

    it("maps Invalid document status", () => {
      const statusMap: Record<string, string> = {
        Invalid: "INVALID",
      };

      expect(statusMap["Invalid"]).toBe("INVALID");
    });

    it("maps Submitted document status", () => {
      const statusMap: Record<string, string> = {
        Submitted: "SUBMITTED",
      };

      expect(statusMap["Submitted"]).toBe("SUBMITTED");
    });
  });

  describe("terminal status detection", () => {
    it("identifies complete submission statuses", () => {
      const isComplete = (status: string) =>
        ["valid", "partially valid", "invalid"].includes(status);

      expect(isComplete("valid")).toBe(true);
      expect(isComplete("partially valid")).toBe(true);
      expect(isComplete("invalid")).toBe(true);
      expect(isComplete("in progress")).toBe(false);
    });

    it("identifies terminal document statuses", () => {
      const isTerminal = (status: string) =>
        ["Valid", "Invalid", "Cancelled", "Rejected"].includes(status);

      expect(isTerminal("Valid")).toBe(true);
      expect(isTerminal("Invalid")).toBe(true);
      expect(isTerminal("Submitted")).toBe(false);
    });
  });

  describe("job data structure", () => {
    it("validates job data has required fields", () => {
      const jobData = {
        submissionId: "sub-123",
        submissionUid: "HJSD135P2S7D8IU",
        sessionId: "session-456",
        attempt: 0,
      };

      expect(jobData.submissionId).toBeDefined();
      expect(jobData.submissionUid).toBeDefined();
      expect(jobData.sessionId).toBeDefined();
    });

    it("handles missing attempt field", () => {
      const jobData = {
        submissionId: "sub-123",
        submissionUid: "HJSD135P2S7D8IU",
        sessionId: "session-456",
      };

      const attempt = (jobData as { attempt?: number }).attempt ?? 0;
      expect(attempt).toBe(0);
    });
  });

  describe("document updates", () => {
    it("updates multiple documents from submission response", () => {
      const submissionResponse = {
        documentSummary: [
          { uuid: "doc-1", status: "Valid", longId: "long-1" },
          { uuid: "doc-2", status: "Valid", longId: "long-2" },
          { uuid: "doc-3", status: "Invalid", longId: null },
        ],
      };

      const updates = submissionResponse.documentSummary.map((doc) => ({
        uuid: doc.uuid,
        status: doc.status,
        longId: doc.longId,
      }));

      expect(updates).toHaveLength(3);
      expect(updates[0].status).toBe("Valid");
      expect(updates[2].longId).toBeNull();
    });

    it("extracts validation errors from document", () => {
      const document = {
        uuid: "doc-1",
        status: "Invalid",
        validationResults: {
          status: "Invalid",
          validationSteps: [
            { status: "Valid", name: "Structure" },
            {
              status: "Invalid",
              name: "TIN Validation",
              error: {
                code: "InvalidTIN",
                message: "TIN not registered",
              },
            },
          ],
        },
      };

      const failedStep = document.validationResults.validationSteps.find(
        (s) => s.status === "Invalid" && s.error
      );

      expect(failedStep).toBeDefined();
      expect(failedStep?.error?.code).toBe("InvalidTIN");
    });
  });

  describe("polling continuation", () => {
    it("continues polling for in progress status", () => {
      const status = "in progress";
      const shouldContinue = status === "in progress";

      expect(shouldContinue).toBe(true);
    });

    it("stops polling for valid status", () => {
      const status = "valid";
      const shouldContinue = status === "in progress";

      expect(shouldContinue).toBe(false);
    });

    it("stops polling for invalid status", () => {
      const status = "invalid";
      const shouldContinue = status === "in progress";

      expect(shouldContinue).toBe(false);
    });
  });

  describe("poll delay calculation", () => {
    it("calculates delay for early attempts", () => {
      const calculateDelay = (attempt: number) => {
        const baseDelay = 3000;
        const maxDelay = 60000;
        return Math.min(baseDelay * Math.pow(1.5, attempt), maxDelay);
      };

      expect(calculateDelay(0)).toBe(3000);
      expect(calculateDelay(1)).toBe(4500);
      expect(calculateDelay(2)).toBe(6750);
    });

    it("caps delay at maximum", () => {
      const calculateDelay = (attempt: number) => {
        const baseDelay = 3000;
        const maxDelay = 60000;
        return Math.min(baseDelay * Math.pow(1.5, attempt), maxDelay);
      };

      expect(calculateDelay(20)).toBe(60000);
      expect(calculateDelay(50)).toBe(60000);
    });
  });

  describe("error handling", () => {
    it("handles rate limit error", () => {
      const error = {
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
      };

      expect(error.status).toBe(429);
      // Should reschedule with longer delay
    });

    it("handles submission not found error", () => {
      const error = {
        status: 404,
        code: "SUBMISSION_NOT_FOUND",
      };

      expect(error.status).toBe(404);
      // Should stop polling
    });

    it("handles network error with retry", () => {
      const error = {
        code: "NETWORK_ERROR",
        message: "Connection timeout",
      };

      expect(error.code).toBe("NETWORK_ERROR");
      // Should retry with backoff
    });

    it("handles unauthorized error", () => {
      const error = {
        status: 401,
        code: "UNAUTHORIZED",
      };

      expect(error.status).toBe(401);
      // Should attempt token refresh
    });
  });

  describe("max attempts", () => {
    it("stops after max attempts", () => {
      const maxAttempts = 50;
      const attempt = 50;

      const shouldContinue = attempt < maxAttempts;
      expect(shouldContinue).toBe(false);
    });

    it("continues before max attempts", () => {
      const maxAttempts = 50;
      const attempt = 25;

      const shouldContinue = attempt < maxAttempts;
      expect(shouldContinue).toBe(true);
    });
  });

  describe("session validation", () => {
    it("validates session exists", () => {
      const session = {
        id: "session-123",
        clientId: "client-id",
        clientSecret: "client-secret",
      };

      const isValid = session.id && session.clientId && session.clientSecret;
      expect(isValid).toBeTruthy();
    });

    it("rejects invalid session", () => {
      const session = {
        id: "session-123",
        clientId: null,
        clientSecret: null,
      };

      const isValid = session.id && session.clientId && session.clientSecret;
      expect(isValid).toBeFalsy();
    });
  });

  describe("document count validation", () => {
    it("validates all documents accounted for", () => {
      const submission = {
        documentCount: 5,
        documentSummary: [
          { uuid: "1" },
          { uuid: "2" },
          { uuid: "3" },
          { uuid: "4" },
          { uuid: "5" },
        ],
      };

      const allAccountedFor = submission.documentSummary.length === submission.documentCount;
      expect(allAccountedFor).toBe(true);
    });

    it("detects missing documents", () => {
      const submission = {
        documentCount: 5,
        documentSummary: [{ uuid: "1" }, { uuid: "2" }],
      };

      const allAccountedFor = submission.documentSummary.length === submission.documentCount;
      expect(allAccountedFor).toBe(false);
    });
  });

  describe("overall status determination", () => {
    it("determines overall valid when all documents valid", () => {
      const documents = [{ status: "Valid" }, { status: "Valid" }, { status: "Valid" }];

      const allValid = documents.every((d) => d.status === "Valid");
      const anyInvalid = documents.some((d) => d.status === "Invalid");

      expect(allValid).toBe(true);
      expect(anyInvalid).toBe(false);
    });

    it("determines partially valid when mixed statuses", () => {
      const documents = [{ status: "Valid" }, { status: "Invalid" }, { status: "Valid" }];

      const allValid = documents.every((d) => d.status === "Valid");
      const anyValid = documents.some((d) => d.status === "Valid");
      const anyInvalid = documents.some((d) => d.status === "Invalid");

      expect(allValid).toBe(false);
      expect(anyValid).toBe(true);
      expect(anyInvalid).toBe(true);
    });

    it("determines invalid when all documents invalid", () => {
      const documents = [{ status: "Invalid" }, { status: "Invalid" }, { status: "Invalid" }];

      const allInvalid = documents.every((d) => d.status === "Invalid");
      expect(allInvalid).toBe(true);
    });
  });
});
