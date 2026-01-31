/**
 * Actual tests for getSubmission that import and test the real function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSubmission, isTerminalStatus } from "../../src/einvoice/getSubmission.js";
import type { SessionCredentials } from "../../src/types.js";
import { TokenManager } from "../../src/tokenManager.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock TokenManager
vi.mock("../../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("getSubmission (actual)", () => {
  let mockTokenManager: TokenManager;
  let mockSession: SessionCredentials;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTokenManager = {
      getToken: vi.fn().mockResolvedValue({
        ok: true,
        token: { accessToken: "test-access-token", expiresAt: Date.now() + 3600000 },
      }),
      refreshToken: vi.fn().mockResolvedValue({
        ok: true,
        token: { accessToken: "refreshed-token", expiresAt: Date.now() + 3600000 },
      }),
    } as unknown as TokenManager;

    mockSession = {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      env: "SANDBOX",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful submission retrieval", () => {
    it("returns submission details on 200 response", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
        overallStatus: "valid",
        documentCount: 2,
        dateTimeReceived: "2024-01-15T14:20:10Z",
        documentSummary: [
          {
            uuid: "uuid-1",
            longId: "longid-1",
            internalId: "INV001",
            status: "Valid",
            dateTimeValidated: "2024-01-15T14:20:15Z",
            issuerTin: "C12345678901",
            issuerName: "Test Company",
            receiverId: "C98765432100",
            receiverName: "Buyer",
            totalPayableAmount: 106.00,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({
          correlationid: "corr-123",
          "x-rate-limit-limit": "300",
          "x-rate-limit-remaining": "299",
        }),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "HJSD135P2S7D8IU" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.submissionUid).toBe("HJSD135P2S7D8IU");
        expect(result.result.overallStatus).toBe("valid");
        expect(result.result.documentSummary).toHaveLength(1);
        expect(result.result.meta.correlationId).toBe("corr-123");
      }
    });

    it("handles empty document summary", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
        overallStatus: "in progress",
        documentCount: 0,
        dateTimeReceived: "2024-01-15T14:20:10Z",
        documentSummary: [],
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "HJSD135P2S7D8IU" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documentSummary).toHaveLength(0);
      }
    });

    it("handles missing document summary (undefined)", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
        overallStatus: "in progress",
        documentCount: 0,
        dateTimeReceived: "2024-01-15T14:20:10Z",
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "HJSD135P2S7D8IU" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documentSummary).toHaveLength(0);
      }
    });
  });

  describe("rate limiting", () => {
    it("returns rate limit error when local limiter blocks", async () => {
      const mockRateLimiter = {
        consume: vi.fn().mockReturnValue({
          allowed: false,
          limit: 300,
          remaining: 0,
        }),
      };

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager, rateLimiter: mockRateLimiter as any }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("RATE_LIMIT_EXCEEDED");
      }
    });

    it("returns rate limit error on 429 response", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 429,
        headers: new Headers({
          "retry-after": "60",
          correlationid: "corr-429",
        }),
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("UPSTREAM_RATE_LIMIT");
      }
    });
  });

  describe("authentication errors", () => {
    it("returns error when token acquisition fails", async () => {
      mockTokenManager.getToken = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          status: 401,
          message: "Invalid credentials",
          code: "LOGIN_FAILED",
        },
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("attempts token refresh on 401 and retries", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
        overallStatus: "valid",
        documentCount: 1,
        dateTimeReceived: "2024-01-15T14:20:10Z",
        documentSummary: [],
      };

      mockFetch
        .mockResolvedValueOnce({
          status: 401,
          headers: new Headers({}),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: new Headers({}),
          json: () => Promise.resolve(upstreamResponse),
        });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(mockTokenManager.refreshToken).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it("returns error when refresh fails", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 401,
        headers: new Headers({}),
      });

      mockTokenManager.refreshToken = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          status: 401,
          message: "Refresh failed",
          code: "REFRESH_FAILED",
        },
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REFRESH_FAILED");
      }
    });
  });

  describe("not found error", () => {
    it("returns not found on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        headers: new Headers({ correlationid: "corr-404" }),
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "non-existent" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
        expect(result.error.code).toBe("SUBMISSION_NOT_FOUND");
      }
    });
  });

  describe("network errors", () => {
    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.code).toBe("NETWORK_ERROR");
        expect(result.error.message).toBe("Network timeout");
      }
    });

    it("handles non-Error throw", async () => {
      mockFetch.mockRejectedValueOnce("Unknown error");

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Network error");
      }
    });
  });

  describe("generic errors", () => {
    it("handles 500 with error body", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 500,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "Internal server error",
          code: "SERVER_ERROR",
        }),
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
        expect(result.error.code).toBe("SERVER_ERROR");
      }
    });

    it("handles error with error field", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 500,
        headers: new Headers({}),
        json: () => Promise.resolve({
          error: "Something went wrong",
        }),
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Something went wrong");
      }
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 502,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(502);
        expect(result.error.message).toContain("502");
      }
    });
  });

  describe("intermediary mode", () => {
    it("includes onbehalfof header for intermediary session", async () => {
      const intermediarySession = {
        ...mockSession,
        mode: "INTERMEDIARY" as const,
        onBehalfOf: "C98765432100",
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          submissionUid: "test",
          overallStatus: "valid",
          documentCount: 0,
          dateTimeReceived: new Date().toISOString(),
        }),
      });

      await getSubmission(
        intermediarySession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            onbehalfof: "C98765432100",
          }),
        })
      );
    });
  });

  describe("pagination", () => {
    it("uses default page parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          submissionUid: "test",
          overallStatus: "valid",
          documentCount: 0,
          dateTimeReceived: new Date().toISOString(),
        }),
      });

      await getSubmission(
        mockSession,
        { submissionUid: "test-uid" },
        { tokenManager: mockTokenManager }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("pageNo=1"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("pageSize=100"),
        expect.any(Object)
      );
    });

    it("uses custom page parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          submissionUid: "test",
          overallStatus: "valid",
          documentCount: 0,
          dateTimeReceived: new Date().toISOString(),
        }),
      });

      await getSubmission(
        mockSession,
        { submissionUid: "test-uid", pageNo: 2, pageSize: 50 },
        { tokenManager: mockTokenManager }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("pageNo=2"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("pageSize=50"),
        expect.any(Object)
      );
    });
  });

  describe("isTerminalStatus", () => {
    it("returns true for valid status", () => {
      expect(isTerminalStatus("valid")).toBe(true);
    });

    it("returns true for invalid status", () => {
      expect(isTerminalStatus("invalid")).toBe(true);
    });

    it("returns true for partially valid status", () => {
      expect(isTerminalStatus("partially valid")).toBe(true);
    });

    it("returns false for in progress status", () => {
      expect(isTerminalStatus("in progress")).toBe(false);
    });

    it("returns false for unknown status", () => {
      expect(isTerminalStatus("unknown")).toBe(false);
    });
  });
});
