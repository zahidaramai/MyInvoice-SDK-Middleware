/**
 * Actual tests for getDocument that import and test the real function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDocument } from "../../src/einvoice/getDocument.js";
import type { SessionCredentials } from "../../src/types.js";
import { TokenManager } from "../../src/tokenManager.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock TokenManager
vi.mock("../../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("getDocument (actual)", () => {
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

  describe("successful document retrieval", () => {
    it("returns XML document on 200 response", async () => {
      const xmlContent = `<?xml version="1.0"?><Invoice><ID>INV001</ID></Invoice>`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "application/xml",
          correlationid: "corr-123",
          "x-rate-limit-limit": "300",
          "x-rate-limit-remaining": "299",
        }),
        text: () => Promise.resolve(xmlContent),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.document).toBe(xmlContent);
        expect(result.result.format).toBe("XML");
        expect(result.result.meta.correlationId).toBe("corr-123");
      }
    });

    it("returns JSON document on 200 response", async () => {
      const jsonContent = `{"Invoice": {"ID": "INV001"}}`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "application/json",
        }),
        text: () => Promise.resolve(jsonContent),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.document).toBe(jsonContent);
        expect(result.result.format).toBe("JSON");
      }
    });

    it("detects XML from content when content-type is missing", async () => {
      const xmlContent = `<Invoice><ID>INV001</ID></Invoice>`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        text: () => Promise.resolve(xmlContent),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.format).toBe("XML");
      }
    });

    it("detects JSON from content when content-type is missing", async () => {
      const jsonContent = `{"id": "test"}`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        text: () => Promise.resolve(jsonContent),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.format).toBe("JSON");
      }
    });

    it("detects JSON array from content", async () => {
      const jsonContent = `[{"id": "test"}]`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        text: () => Promise.resolve(jsonContent),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.format).toBe("JSON");
      }
    });

    it("defaults to JSON for unknown content", async () => {
      const unknownContent = `some random text`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        text: () => Promise.resolve(unknownContent),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.format).toBe("JSON");
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

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
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
        ok: false,
        status: 429,
        headers: new Headers({
          "retry-after": "60",
          correlationid: "corr-429",
        }),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
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
        ok: true,
        status: 200,
        headers: new Headers({}),
        text: () => Promise.resolve("{}"),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
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

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("attempts token refresh on 401 and retries successfully", async () => {
      const xmlContent = `<?xml version="1.0"?><Invoice/>`;

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: new Headers({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({}),
          text: () => Promise.resolve(xmlContent),
        });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(mockTokenManager.refreshToken).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it("returns unauthorized when refresh fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
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

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(401);
        expect(result.error.code).toBe("UNAUTHORIZED");
      }
    });

    it("returns unauthorized when retry after refresh fails", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: new Headers({}),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          headers: new Headers({}),
          text: () => Promise.resolve("Forbidden"),
        });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(401);
        expect(result.error.code).toBe("UNAUTHORIZED");
      }
    });
  });

  describe("not found error", () => {
    it("returns not found on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ correlationid: "corr-404" }),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "non-existent-uuid", longId: "non-existent-longid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
        expect(result.error.code).toBe("DOCUMENT_NOT_FOUND");
      }
    });
  });

  describe("network errors", () => {
    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
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

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
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
        ok: false,
        status: 500,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "Internal server error",
          code: "SERVER_ERROR",
        }),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
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
        ok: false,
        status: 500,
        headers: new Headers({}),
        json: () => Promise.resolve({
          error: "Something went wrong",
        }),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("500");
      }
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
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
        onBehalfOf: "C98765432100",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        text: () => Promise.resolve("{}"),
      });

      await getDocument(
        intermediarySession,
        { uuid: "test-uuid", longId: "test-long-id" },
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

  describe("metadata extraction", () => {
    it("extracts all rate limit headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          correlationid: "corr-full",
          "x-rate-limit-limit": "300",
          "x-rate-limit-remaining": "250",
          "x-rate-limit-reset": "1700000000",
        }),
        text: () => Promise.resolve("{}"),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
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
        ok: true,
        status: 200,
        headers: new Headers({
          "x-correlation-id": "x-corr-id",
        }),
        text: () => Promise.resolve("{}"),
      });

      const result = await getDocument(
        mockSession,
        { uuid: "test-uuid", longId: "test-long-id" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.meta.correlationId).toBe("x-corr-id");
      }
    });
  });

  describe("URL construction", () => {
    it("constructs correct URL with uuid and longId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        text: () => Promise.resolve("{}"),
      });

      await getDocument(
        mockSession,
        { uuid: "abc-123", longId: "xyz-789" },
        { tokenManager: mockTokenManager }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1.0/documents/abc-123/raw/xyz-789"),
        expect.any(Object)
      );
    });
  });
});
