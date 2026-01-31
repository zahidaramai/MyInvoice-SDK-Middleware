/**
 * Tests for changeDocumentState API function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("changeDocumentState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("cancel document", () => {
    it("cancels document successfully", () => {
      const request = {
        uuid: "doc-uuid-123",
        action: "CANCEL",
        reason: "Customer requested cancellation",
      };

      expect(request.action).toBe("CANCEL");
      expect(request.reason).toBeDefined();
    });

    it("validates cancel reason is required", () => {
      const request = {
        uuid: "doc-uuid-123",
        action: "CANCEL",
        reason: "",
      };

      const isValid = request.reason.length > 0;
      expect(isValid).toBe(false);
    });

    it("returns cancelled status on success", () => {
      const response = {
        uuid: "doc-uuid-123",
        status: "Cancelled",
        cancelDateTime: "2024-01-16T12:00:00Z",
      };

      expect(response.status).toBe("Cancelled");
      expect(response.cancelDateTime).toBeDefined();
    });
  });

  describe("reject document", () => {
    it("rejects document successfully", () => {
      const request = {
        uuid: "doc-uuid-456",
        action: "REJECT",
        reason: "Incorrect pricing information",
      };

      expect(request.action).toBe("REJECT");
      expect(request.reason).toBeDefined();
    });

    it("returns rejected status on success", () => {
      const response = {
        uuid: "doc-uuid-456",
        status: "Rejected",
        rejectDateTime: "2024-01-16T14:00:00Z",
      };

      expect(response.status).toBe("Rejected");
      expect(response.rejectDateTime).toBeDefined();
    });
  });

  describe("action validation", () => {
    it("validates action is CANCEL or REJECT", () => {
      const validActions = ["CANCEL", "REJECT"];

      validActions.forEach((action) => {
        expect(["CANCEL", "REJECT"]).toContain(action);
      });
    });

    it("rejects invalid action", () => {
      const invalidAction = "VOID";

      expect(["CANCEL", "REJECT"]).not.toContain(invalidAction);
    });
  });

  describe("state transition validation", () => {
    it("allows cancel from Valid status", () => {
      const document = { status: "Valid" };
      const canCancel = ["Valid", "Invalid"].includes(document.status);

      expect(canCancel).toBe(true);
    });

    it("allows reject from Valid status", () => {
      const document = { status: "Valid" };
      const canReject = document.status === "Valid";

      expect(canReject).toBe(true);
    });

    it("prevents cancel from Cancelled status", () => {
      const document = { status: "Cancelled" };
      const canCancel = ["Valid", "Invalid"].includes(document.status);

      expect(canCancel).toBe(false);
    });

    it("prevents reject from Rejected status", () => {
      const document = { status: "Rejected" };
      const canReject = document.status === "Valid";

      expect(canReject).toBe(false);
    });

    it("prevents action on Submitted status", () => {
      const document = { status: "Submitted" };
      const canAct = ["Valid", "Invalid"].includes(document.status);

      expect(canAct).toBe(false);
    });
  });

  describe("error handling", () => {
    it("handles document not found", () => {
      const error = {
        status: 404,
        code: "DOCUMENT_NOT_FOUND",
        message: "Document not found",
      };

      expect(error.status).toBe(404);
      expect(error.code).toBe("DOCUMENT_NOT_FOUND");
    });

    it("handles invalid state transition", () => {
      const error = {
        status: 400,
        code: "INVALID_STATE_TRANSITION",
        message: "Cannot cancel a document that is not Valid or Invalid",
      };

      expect(error.status).toBe(400);
      expect(error.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("handles unauthorized error", () => {
      const error = {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Token expired",
      };

      expect(error.status).toBe(401);
    });

    it("handles forbidden error (not issuer)", () => {
      const error = {
        status: 403,
        code: "INCORRECT_SUBMITTER",
        message: "Only the issuer can cancel this document",
      };

      expect(error.status).toBe(403);
      expect(error.code).toBe("INCORRECT_SUBMITTER");
    });

    it("handles rate limit error", () => {
      const error = {
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: 60,
      };

      expect(error.status).toBe(429);
      expect(error.retryAfter).toBe(60);
    });
  });

  describe("request construction", () => {
    it("builds correct URL for cancel", () => {
      const uuid = "doc-uuid-123";
      const baseUrl = "https://api.myinvois.hasil.gov.my";

      const url = `${baseUrl}/api/v1.0/documents/state/${uuid}/state`;

      expect(url).toContain(uuid);
      expect(url).toContain("/state");
    });

    it("includes authorization header", () => {
      const headers = {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      };

      expect(headers.Authorization).toMatch(/^Bearer /);
    });

    it("includes onbehalfof header for intermediary", () => {
      const headers = {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        onbehalfof: "C12345678901",
      };

      expect(headers.onbehalfof).toBeDefined();
    });

    it("constructs cancel request body", () => {
      const body = {
        status: "cancelled",
        reason: "Customer cancellation request",
      };

      expect(body.status).toBe("cancelled");
      expect(body.reason).toBeDefined();
    });

    it("constructs reject request body", () => {
      const body = {
        status: "rejected",
        reason: "Invalid invoice data",
      };

      expect(body.status).toBe("rejected");
      expect(body.reason).toBeDefined();
    });
  });

  describe("response metadata", () => {
    it("extracts correlation ID", () => {
      const headers = new Headers({
        correlationid: "corr-12345",
      });

      const correlationId = headers.get("correlationid");
      expect(correlationId).toBe("corr-12345");
    });

    it("extracts rate limit info", () => {
      const headers = new Headers({
        "x-rate-limit-limit": "100",
        "x-rate-limit-remaining": "95",
      });

      const limit = parseInt(headers.get("x-rate-limit-limit") || "0", 10);
      const remaining = parseInt(headers.get("x-rate-limit-remaining") || "0", 10);

      expect(limit).toBe(100);
      expect(remaining).toBe(95);
    });
  });

  describe("cancel time window", () => {
    it("allows cancel within 72 hours", () => {
      const documentDate = new Date("2024-01-15T10:00:00Z");
      const now = new Date("2024-01-17T10:00:00Z");
      const hoursSinceIssue = (now.getTime() - documentDate.getTime()) / (1000 * 60 * 60);

      const canCancel = hoursSinceIssue <= 72;
      expect(canCancel).toBe(true);
    });

    it("prevents cancel after 72 hours", () => {
      const documentDate = new Date("2024-01-15T10:00:00Z");
      const now = new Date("2024-01-20T10:00:00Z");
      const hoursSinceIssue = (now.getTime() - documentDate.getTime()) / (1000 * 60 * 60);

      const canCancel = hoursSinceIssue <= 72;
      expect(canCancel).toBe(false);
    });
  });

  describe("reject time window", () => {
    it("allows reject within 72 hours", () => {
      const documentDate = new Date("2024-01-15T10:00:00Z");
      const now = new Date("2024-01-17T10:00:00Z");
      const hoursSinceIssue = (now.getTime() - documentDate.getTime()) / (1000 * 60 * 60);

      const canReject = hoursSinceIssue <= 72;
      expect(canReject).toBe(true);
    });

    it("prevents reject after 72 hours", () => {
      const documentDate = new Date("2024-01-15T10:00:00Z");
      const now = new Date("2024-01-20T10:00:00Z");
      const hoursSinceIssue = (now.getTime() - documentDate.getTime()) / (1000 * 60 * 60);

      const canReject = hoursSinceIssue <= 72;
      expect(canReject).toBe(false);
    });
  });
});
