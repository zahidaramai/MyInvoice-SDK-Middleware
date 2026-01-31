/**
 * Actual tests for submitDocuments that import and test the real function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { submitDocuments } from "../../src/einvoice/submitDocuments.js";
import type { SessionCredentials } from "../../src/types.js";
import { TokenManager } from "../../src/tokenManager.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock TokenManager
vi.mock("../../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("submitDocuments (actual)", () => {
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

  describe("successful submission", () => {
    it("returns 202 with accepted documents", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
        acceptedDocuments: [
          { uuid: "uuid-1", invoiceCodeNumber: "INV001" },
          { uuid: "uuid-2", invoiceCodeNumber: "INV002" },
        ],
        rejectedDocuments: [],
      };

      mockFetch.mockResolvedValueOnce({
        status: 202,
        headers: new Headers({
          correlationid: "corr-123",
          "x-rate-limit-limit": "100",
          "x-rate-limit-remaining": "99",
        }),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.submissionUid).toBe("HJSD135P2S7D8IU");
        expect(result.result.acceptedDocuments).toHaveLength(2);
        expect(result.result.acceptedDocuments[0].uuid).toBe("uuid-1");
        expect(result.result.acceptedDocuments[0].codeNumber).toBe("INV001");
        expect(result.result.rejectedDocuments).toHaveLength(0);
        expect(result.result.meta.correlationId).toBe("corr-123");
      }
    });

    it("returns 202 with rejected documents", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
        acceptedDocuments: [],
        rejectedDocuments: [
          {
            invoiceCodeNumber: "INV003",
            error: {
              code: "InvalidTotalAmount",
              message: "Tax amount does not match",
              propertyName: "TaxTotal",
              propertyPath: "Invoice/TaxTotal",
              target: "100.00",
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        status: 202,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.rejectedDocuments).toHaveLength(1);
        expect(result.result.rejectedDocuments[0].codeNumber).toBe("INV003");
        expect(result.result.rejectedDocuments[0].errorCode).toBe("InvalidTotalAmount");
        expect(result.result.rejectedDocuments[0].errorDetails).toBeDefined();
      }
    });

    it("handles rejected documents with innerError", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
        acceptedDocuments: [],
        rejectedDocuments: [
          {
            invoiceCodeNumber: "INV003",
            error: {
              code: "ValidationError",
              message: "Multiple errors",
              innerError: [
                { code: "Error1", message: "First error" },
                { code: "Error2", message: "Second error" },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        status: 202,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.rejectedDocuments[0].errorDetails).toHaveLength(2);
      }
    });

    it("handles rejected documents with details array", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
        acceptedDocuments: [],
        rejectedDocuments: [
          {
            invoiceCodeNumber: "INV003",
            error: {
              code: "ValidationError",
              message: "Validation failed",
              details: [
                { code: "Detail1", message: "Detail error 1" },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        status: 202,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.rejectedDocuments[0].errorDetails).toBeDefined();
      }
    });

    it("handles empty acceptedDocuments and rejectedDocuments", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
      };

      mockFetch.mockResolvedValueOnce({
        status: 202,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.acceptedDocuments).toHaveLength(0);
        expect(result.result.rejectedDocuments).toHaveLength(0);
      }
    });
  });

  describe("rate limiting", () => {
    it("returns rate limit error when local limiter blocks", async () => {
      const mockRateLimiter = {
        consume: vi.fn().mockReturnValue({
          allowed: false,
          limit: 100,
          remaining: 0,
        }),
      };

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
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

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("UPSTREAM_RATE_LIMIT");
      }
    });

    it("checks rate limit on retry after 401", async () => {
      const mockRateLimiter = {
        consume: vi.fn()
          .mockReturnValueOnce({ allowed: true, limit: 100, remaining: 99 })
          .mockReturnValueOnce({ allowed: false, limit: 100, remaining: 0 }),
      };

      mockFetch.mockResolvedValueOnce({
        status: 401,
        headers: new Headers({}),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager, rateLimiter: mockRateLimiter as any }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(result.error.message).toContain("retry");
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

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("attempts token refresh on 401 and retries successfully", async () => {
      const upstreamResponse = {
        submissionUid: "HJSD135P2S7D8IU",
        acceptedDocuments: [{ uuid: "uuid-1", invoiceCodeNumber: "INV001" }],
        rejectedDocuments: [],
      };

      mockFetch
        .mockResolvedValueOnce({
          status: 401,
          headers: new Headers({}),
        })
        .mockResolvedValueOnce({
          status: 202,
          headers: new Headers({}),
          json: () => Promise.resolve(upstreamResponse),
        });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
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

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REFRESH_FAILED");
      }
    });

    it("handles network error on retry", async () => {
      mockFetch
        .mockResolvedValueOnce({
          status: 401,
          headers: new Headers({}),
        })
        .mockRejectedValueOnce(new Error("Network timeout"));

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NETWORK_ERROR");
      }
    });

    it("handles timeout on retry", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";

      mockFetch
        .mockResolvedValueOnce({
          status: 401,
          headers: new Headers({}),
        })
        .mockRejectedValueOnce(abortError);

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TIMEOUT_ERROR");
      }
    });

    it("returns error when retry after refresh also fails", async () => {
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

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
      }
    });
  });

  describe("duplicate submission (422)", () => {
    it("returns duplicate submission error", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 422,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "Duplicate submission",
          code: "DuplicateSubmission",
        }),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(422);
        expect(result.error.code).toBe("DUPLICATE_SUBMISSION");
      }
    });

    it("detects duplicate from message", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 422,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "This is a duplicate submission detected",
          code: "ValidationError",
        }),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DUPLICATE_SUBMISSION");
      }
    });

    it("handles 422 validation error that is not duplicate", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 422,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "Invalid tax amount",
          code: "InvalidTaxAmount",
        }),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("InvalidTaxAmount");
      }
    });

    it("handles 422 with non-JSON body", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 422,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(422);
      }
    });
  });

  describe("network errors", () => {
    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.code).toBe("NETWORK_ERROR");
      }
    });

    it("handles timeout error", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TIMEOUT_ERROR");
        expect(result.error.message).toBe("Request timed out");
      }
    });

    it("handles non-Error throw", async () => {
      mockFetch.mockRejectedValueOnce("Unknown error");

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
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

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
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

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
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

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
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
        status: 202,
        headers: new Headers({}),
        json: () => Promise.resolve({
          submissionUid: "test",
          acceptedDocuments: [],
          rejectedDocuments: [],
        }),
      });

      await submitDocuments(
        intermediarySession,
        { documents: [{ format: "JSON", document: "{}" }] },
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

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
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

      const result = await submitDocuments(
        mockSession,
        { documents: [{ format: "JSON", document: "{}" }] },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
    });
  });
});
