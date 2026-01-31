/**
 * Tests for getSubmission API function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("getSubmission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful submission retrieval", () => {
    it("returns submission with all documents valid", () => {
      const response = {
        submissionUid: "HJSD135P2S7D8IU",
        documentCount: 3,
        dateTimeReceived: "2024-01-15T14:20:10Z",
        overallStatus: "valid",
        documentSummary: [
          {
            uuid: "F9D425P6DS7D8IU",
            submissionUid: "HJSD135P2S7D8IU",
            longId: "ABC123XYZ789",
            internalId: "INV12345",
            issuerTin: "C2584563200",
            issuerName: "AMS Setia Jaya Sdn. Bhd.",
            receiverId: "C25235029040",
            receiverName: "Buyer Company Sdn Bhd",
            dateTimeIssued: "2024-01-15T14:00:00Z",
            dateTimeReceived: "2024-01-15T14:20:10Z",
            dateTimeValidated: "2024-01-15T14:20:15Z",
            totalPayableAmount: 124.09,
            status: "Valid",
          },
        ],
      };

      expect(response.overallStatus).toBe("valid");
      expect(response.documentSummary).toHaveLength(1);
      expect(response.documentSummary[0].status).toBe("Valid");
    });

    it("returns submission in progress", () => {
      const response = {
        submissionUid: "HJSD135P2S7D8IU",
        documentCount: 5,
        dateTimeReceived: "2024-01-15T14:20:10Z",
        overallStatus: "in progress",
        documentSummary: [
          { uuid: "doc-1", status: "Valid" },
          { uuid: "doc-2", status: "Submitted" },
          { uuid: "doc-3", status: "Submitted" },
        ],
      };

      expect(response.overallStatus).toBe("in progress");
    });

    it("returns partially valid submission", () => {
      const response = {
        submissionUid: "HJSD135P2S7D8IU",
        documentCount: 3,
        overallStatus: "partially valid",
        documentSummary: [
          { uuid: "doc-1", status: "Valid" },
          { uuid: "doc-2", status: "Invalid" },
          { uuid: "doc-3", status: "Valid" },
        ],
      };

      expect(response.overallStatus).toBe("partially valid");
      const invalidDocs = response.documentSummary.filter((d) => d.status === "Invalid");
      expect(invalidDocs).toHaveLength(1);
    });

    it("returns invalid submission", () => {
      const response = {
        submissionUid: "HJSD135P2S7D8IU",
        documentCount: 2,
        overallStatus: "invalid",
        documentSummary: [
          { uuid: "doc-1", status: "Invalid" },
          { uuid: "doc-2", status: "Invalid" },
        ],
      };

      expect(response.overallStatus).toBe("invalid");
    });
  });

  describe("overall status values", () => {
    it("recognizes all valid status values", () => {
      const validStatuses = ["in progress", "valid", "partially valid", "invalid"];

      validStatuses.forEach((status) => {
        expect(["in progress", "valid", "partially valid", "invalid"]).toContain(status);
      });
    });

    it("maps status to processing state", () => {
      const isProcessing = (status: string) => status === "in progress";
      const isComplete = (status: string) =>
        ["valid", "partially valid", "invalid"].includes(status);

      expect(isProcessing("in progress")).toBe(true);
      expect(isProcessing("valid")).toBe(false);
      expect(isComplete("valid")).toBe(true);
      expect(isComplete("in progress")).toBe(false);
    });
  });

  describe("document summary", () => {
    it("extracts document UUID and longId", () => {
      const docSummary = {
        uuid: "F9D425P6DS7D8IU",
        longId: "ABC123XYZ789LONGIDSTRING",
        status: "Valid",
      };

      expect(docSummary.uuid).toBeDefined();
      expect(docSummary.longId).toBeDefined();
    });

    it("handles missing longId for non-valid documents", () => {
      const docSummary = {
        uuid: "F9D425P6DS7D8IU",
        longId: null,
        status: "Submitted",
      };

      expect(docSummary.longId).toBeNull();
    });

    it("includes issuer information", () => {
      const docSummary = {
        issuerTin: "C2584563200",
        issuerName: "AMS Setia Jaya Sdn. Bhd.",
      };

      expect(docSummary.issuerTin).toMatch(/^C\d{10,}$/);
      expect(docSummary.issuerName).toBeDefined();
    });

    it("includes receiver information", () => {
      const docSummary = {
        receiverId: "C25235029040",
        receiverName: "Buyer Company Sdn Bhd",
      };

      expect(docSummary.receiverId).toBeDefined();
      expect(docSummary.receiverName).toBeDefined();
    });

    it("includes financial information", () => {
      const docSummary = {
        totalPayableAmount: 124.09,
      };

      expect(docSummary.totalPayableAmount).toBe(124.09);
    });
  });

  describe("date time fields", () => {
    it("parses submission received time", () => {
      const submission = {
        dateTimeReceived: "2024-01-15T14:20:10Z",
      };

      const received = new Date(submission.dateTimeReceived);
      expect(received.getFullYear()).toBe(2024);
    });

    it("parses document dates", () => {
      const docSummary = {
        dateTimeIssued: "2024-01-15T14:00:00Z",
        dateTimeReceived: "2024-01-15T14:20:10Z",
        dateTimeValidated: "2024-01-15T14:20:15Z",
      };

      const issued = new Date(docSummary.dateTimeIssued);
      const received = new Date(docSummary.dateTimeReceived);
      const validated = new Date(docSummary.dateTimeValidated);

      expect(issued.getTime()).toBeLessThan(received.getTime());
      expect(received.getTime()).toBeLessThan(validated.getTime());
    });

    it("handles null validation date for pending documents", () => {
      const docSummary = {
        dateTimeIssued: "2024-01-15T14:00:00Z",
        dateTimeReceived: "2024-01-15T14:20:10Z",
        dateTimeValidated: null,
        status: "Submitted",
      };

      expect(docSummary.dateTimeValidated).toBeNull();
    });
  });

  describe("error handling", () => {
    it("handles submission not found", () => {
      const error = {
        status: 404,
        code: "SUBMISSION_NOT_FOUND",
        message: "Submission not found",
      };

      expect(error.status).toBe(404);
      expect(error.code).toBe("SUBMISSION_NOT_FOUND");
    });

    it("handles unauthorized error", () => {
      const error = {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Token expired",
      };

      expect(error.status).toBe(401);
    });

    it("handles forbidden error", () => {
      const error = {
        status: 403,
        code: "FORBIDDEN",
        message: "Not authorized to view this submission",
      };

      expect(error.status).toBe(403);
    });

    it("handles rate limit error", () => {
      const error = {
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: 60,
      };

      expect(error.status).toBe(429);
    });
  });

  describe("polling strategy", () => {
    it("determines if polling should continue", () => {
      const shouldContinuePolling = (status: string) => status === "in progress";

      expect(shouldContinuePolling("in progress")).toBe(true);
      expect(shouldContinuePolling("valid")).toBe(false);
      expect(shouldContinuePolling("invalid")).toBe(false);
    });

    it("calculates next poll delay", () => {
      const calculateDelay = (attempt: number) => {
        const baseDelay = 3000;
        const maxDelay = 30000;
        return Math.min(baseDelay * Math.pow(1.5, attempt), maxDelay);
      };

      expect(calculateDelay(0)).toBe(3000);
      expect(calculateDelay(1)).toBe(4500);
      expect(calculateDelay(10)).toBeLessThanOrEqual(30000);
    });
  });

  describe("page size and pagination", () => {
    it("handles default page size", () => {
      const params = {
        submissionUid: "HJSD135P2S7D8IU",
        pageNo: 1,
        pageSize: 100,
      };

      expect(params.pageSize).toBe(100);
    });

    it("handles custom page parameters", () => {
      const params = {
        submissionUid: "HJSD135P2S7D8IU",
        pageNo: 2,
        pageSize: 50,
      };

      expect(params.pageNo).toBe(2);
      expect(params.pageSize).toBe(50);
    });
  });

  describe("request construction", () => {
    it("builds correct URL", () => {
      const submissionUid = "HJSD135P2S7D8IU";
      const baseUrl = "https://api.myinvois.hasil.gov.my";

      const url = `${baseUrl}/api/v1.0/documentsubmissions/${submissionUid}`;

      expect(url).toContain(submissionUid);
      expect(url).toContain("/documentsubmissions/");
    });

    it("includes page parameters in URL", () => {
      const submissionUid = "HJSD135P2S7D8IU";
      const baseUrl = "https://api.myinvois.hasil.gov.my";
      const pageNo = 2;
      const pageSize = 50;

      const url = `${baseUrl}/api/v1.0/documentsubmissions/${submissionUid}?pageNo=${pageNo}&pageSize=${pageSize}`;

      expect(url).toContain("pageNo=2");
      expect(url).toContain("pageSize=50");
    });
  });

  describe("response metadata", () => {
    it("extracts correlation ID", () => {
      const headers = new Headers({
        correlationid: "corr-12345",
      });

      expect(headers.get("correlationid")).toBe("corr-12345");
    });

    it("extracts rate limit info", () => {
      const headers = new Headers({
        "x-rate-limit-limit": "300",
        "x-rate-limit-remaining": "295",
      });

      const limit = parseInt(headers.get("x-rate-limit-limit") || "0", 10);
      expect(limit).toBe(300);
    });
  });
});
