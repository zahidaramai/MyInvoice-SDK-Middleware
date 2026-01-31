/**
 * Actual tests for changeDocumentState that import and test the real function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { changeDocumentState } from "../../src/einvoice/changeDocumentState.js";
import type { SessionCredentials } from "../../src/types.js";
import { TokenManager } from "../../src/tokenManager.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock TokenManager
vi.mock("../../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("changeDocumentState (actual)", () => {
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

  describe("successful state change - cancel", () => {
    it("returns success on 200 response for cancel", async () => {
      const upstreamResponse = {
        uuid: "test-uuid",
        status: "cancelled",
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

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Customer request" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.uuid).toBe("test-uuid");
        expect(result.result.status).toBe("cancelled");
        expect(result.result.meta.correlationId).toBe("corr-123");
      }
    });
  });

  describe("successful state change - reject", () => {
    it("returns success on 200 response for reject", async () => {
      const upstreamResponse = {
        uuid: "test-uuid",
        status: "rejected",
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "rejected", reason: "Invalid invoice" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.status).toBe("rejected");
      }
    });
  });

  describe("rate limiting", () => {
    it("returns rate limit error when local limiter blocks for cancel", async () => {
      const mockRateLimiter = {
        consume: vi.fn().mockReturnValue({
          allowed: false,
          limit: 300,
          remaining: 0,
        }),
      };

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager, rateLimiter: mockRateLimiter as any }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(result.error.message).toContain("Cancel");
      }
    });

    it("returns rate limit error when local limiter blocks for reject", async () => {
      const mockRateLimiter = {
        consume: vi.fn().mockReturnValue({
          allowed: false,
          limit: 300,
          remaining: 0,
        }),
      };

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "rejected", reason: "Test" },
        { tokenManager: mockTokenManager, rateLimiter: mockRateLimiter as any }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Reject");
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

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("UPSTREAM_RATE_LIMIT");
      }
    });

    it("allows request when rate limiter allows", async () => {
      const mockRateLimiter = {
        consume: vi.fn().mockReturnValue({
          allowed: true,
          limit: 300,
          remaining: 299,
        }),
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ uuid: "test-uuid", status: "cancelled" }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager, rateLimiter: mockRateLimiter as any }
      );

      expect(result.ok).toBe(true);
      expect(mockRateLimiter.consume).toHaveBeenCalled();
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

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("attempts token refresh on 401 and retries successfully", async () => {
      const upstreamResponse = {
        uuid: "test-uuid",
        status: "cancelled",
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

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
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

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REFRESH_FAILED");
      }
    });

    it("returns error when retry after refresh fails", async () => {
      mockFetch
        .mockResolvedValueOnce({
          status: 401,
          headers: new Headers({}),
        })
        .mockResolvedValueOnce({
          status: 500,
          headers: new Headers({}),
          json: () => Promise.resolve({ message: "Server error" }),
        });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
      }
    });
  });

  describe("not found error", () => {
    it("returns not found on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        headers: new Headers({ correlationid: "corr-404" }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "non-existent", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
        expect(result.error.code).toBe("DOCUMENT_NOT_FOUND");
      }
    });
  });

  describe("validation errors (400)", () => {
    it("handles 400 validation error with body", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 400,
        headers: new Headers({}),
        json: () =>
          Promise.resolve({
            message: "Document already cancelled",
            code: "AlreadyCancelled",
          }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
        expect(result.error.code).toBe("AlreadyCancelled");
        expect(result.error.message).toBe("Document already cancelled");
      }
    });

    it("handles 400 with non-JSON body", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 400,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("handles 72-hour window validation error", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 400,
        headers: new Headers({}),
        json: () =>
          Promise.resolve({
            message: "Cancellation window has expired",
            code: "WindowExpired",
          }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("WindowExpired");
      }
    });
  });

  describe("network errors", () => {
    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
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

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
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
        json: () =>
          Promise.resolve({
            message: "Internal server error",
            code: "SERVER_ERROR",
          }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
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
        json: () =>
          Promise.resolve({
            error: "Something went wrong",
          }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
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

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
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
      const intermediarySession: SessionCredentials = {
        ...mockSession,
        mode: "INTERMEDIARY",
        onBehalfOf: "C98765432100",
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ uuid: "test-uuid", status: "cancelled" }),
      });

      await changeDocumentState(
        intermediarySession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
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

  describe("retry-after handling", () => {
    it("uses retry-after header for rate limit reset", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 429,
        headers: new Headers({
          "retry-after": "120",
        }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.meta?.rateLimitReset).toBeDefined();
      }
    });

    it("uses rate limit reset header when no retry-after", async () => {
      const now = Math.floor(Date.now() / 1000);
      const futureReset = now + 60;

      mockFetch.mockResolvedValueOnce({
        status: 429,
        headers: new Headers({
          "x-rate-limit-reset": String(futureReset),
        }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
    });

    it("uses default retry-after when no headers", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 429,
        headers: new Headers({}),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.meta?.rateLimitReset).toBeDefined();
      }
    });
  });

  describe("URL construction", () => {
    it("constructs correct URL with uuid", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ uuid: "abc-123", status: "cancelled" }),
      });

      await changeDocumentState(
        mockSession,
        { uuid: "abc-123", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1.0/documents/state/abc-123/state"),
        expect.any(Object)
      );
    });
  });

  describe("request body", () => {
    it("sends correct body for cancel", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ uuid: "test-uuid", status: "cancelled" }),
      });

      await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Customer request" },
        { tokenManager: mockTokenManager }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ status: "cancelled", reason: "Customer request" }),
        })
      );
    });

    it("sends correct body for reject", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ uuid: "test-uuid", status: "rejected" }),
      });

      await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "rejected", reason: "Invalid data" },
        { tokenManager: mockTokenManager }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ status: "rejected", reason: "Invalid data" }),
        })
      );
    });
  });

  describe("metadata extraction", () => {
    it("extracts all rate limit headers", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({
          correlationid: "corr-full",
          "x-rate-limit-limit": "300",
          "x-rate-limit-remaining": "250",
          "x-rate-limit-reset": "1700000000",
        }),
        json: () => Promise.resolve({ uuid: "test-uuid", status: "cancelled" }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.meta.correlationId).toBe("corr-full");
        expect(result.result.meta.rateLimitLimit).toBe(300);
        expect(result.result.meta.rateLimitRemaining).toBe(250);
        expect(result.result.meta.rateLimitReset).toBe(1700000000);
      }
    });

    it("handles x-correlation-id header", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({
          "x-correlation-id": "x-corr-id",
        }),
        json: () => Promise.resolve({ uuid: "test-uuid", status: "cancelled" }),
      });

      const result = await changeDocumentState(
        mockSession,
        { uuid: "test-uuid", status: "cancelled", reason: "Test" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.meta.correlationId).toBe("x-corr-id");
      }
    });
  });
});
