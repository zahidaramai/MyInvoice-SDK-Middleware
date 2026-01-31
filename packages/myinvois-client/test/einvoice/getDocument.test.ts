/**
 * Tests for getDocument API function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDocument, type GetDocumentParams, type GetDocumentOptions } from "../../src/einvoice/getDocument.js";
import { TokenManager } from "../../src/tokenManager.js";
import type { SessionCredentials } from "../../src/types.js";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("getDocument", () => {
  let mockTokenManager: TokenManager;
  let mockSession: SessionCredentials;
  let mockParams: GetDocumentParams;
  let mockOptions: GetDocumentOptions;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTokenManager = {
      getToken: vi.fn().mockResolvedValue({
        ok: true,
        token: { accessToken: "mock-access-token", expiresAt: Date.now() + 3600000 },
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

    mockParams = {
      uuid: "test-uuid-12345",
      longId: "test-long-id-67890",
    };

    mockOptions = {
      tokenManager: mockTokenManager,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful document retrieval", () => {
    it("returns XML document when content-type is application/xml", async () => {
      const xmlContent = '<?xml version="1.0"?><Invoice><ID>INV001</ID></Invoice>';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "content-type": "application/xml",
          "correlationid": "corr-123",
          "x-rate-limit-limit": "100",
          "x-rate-limit-remaining": "99",
        }),
        text: () => Promise.resolve(xmlContent),
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.document).toBe(xmlContent);
        expect(result.result.format).toBe("XML");
        expect(result.result.meta.correlationId).toBe("corr-123");
        expect(result.result.meta.rateLimitLimit).toBe(100);
        expect(result.result.meta.rateLimitRemaining).toBe(99);
      }
    });

    it("returns JSON document when content-type is application/json", async () => {
      const jsonContent = '{"Invoice":{"ID":"INV001"}}';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "content-type": "application/json",
          "x-correlation-id": "corr-456",
        }),
        text: () => Promise.resolve(jsonContent),
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.document).toBe(jsonContent);
        expect(result.result.format).toBe("JSON");
        expect(result.result.meta.correlationId).toBe("corr-456");
      }
    });

    it("detects XML format by content inspection when no content-type", async () => {
      const xmlContent = '<Invoice><ID>INV001</ID></Invoice>';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        text: () => Promise.resolve(xmlContent),
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.format).toBe("XML");
      }
    });

    it("detects JSON format by content inspection when no content-type", async () => {
      const jsonContent = '{"id": "test"}';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        text: () => Promise.resolve(jsonContent),
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.format).toBe("JSON");
      }
    });

    it("detects JSON array format", async () => {
      const jsonContent = '[{"id": "test"}]';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        text: () => Promise.resolve(jsonContent),
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.format).toBe("JSON");
      }
    });

    it("includes onbehalfof header when session has onBehalfOf", async () => {
      const sessionWithOnBehalf = { ...mockSession, onBehalfOf: "C12345678901" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        text: () => Promise.resolve("{}"),
      });

      await getDocument(sessionWithOnBehalf, mockParams, mockOptions);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            onbehalfof: "C12345678901",
          }),
        })
      );
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

      const result = await getDocument(mockSession, mockParams, {
        ...mockOptions,
        rateLimiter: mockRateLimiter as any,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(result.error.meta?.rateLimitLimit).toBe(100);
      }
    });

    it("returns rate limit error on 429 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({
          "retry-after": "60",
          "correlationid": "corr-789",
        }),
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("UPSTREAM_RATE_LIMIT");
        expect(result.error.meta?.rateLimitReset).toBe(60);
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

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("attempts token refresh on 401 and retries request", async () => {
      const xmlContent = '<?xml version="1.0"?><Invoice/>';

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: new Headers({ correlationid: "corr-401" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ "content-type": "application/xml" }),
          text: () => Promise.resolve(xmlContent),
        });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(mockTokenManager.refreshToken).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it("returns unauthorized when refresh fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ correlationid: "corr-401" }),
      });

      mockTokenManager.refreshToken = vi.fn().mockResolvedValue({
        ok: false,
        error: { status: 401, message: "Refresh failed", code: "REFRESH_FAILED" },
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(401);
        expect(result.error.code).toBe("UNAUTHORIZED");
      }
    });

    it("returns unauthorized when retry after refresh also fails", async () => {
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
        });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(401);
        expect(result.error.code).toBe("UNAUTHORIZED");
      }
    });
  });

  describe("document not found", () => {
    it("returns not found error on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ correlationid: "corr-404" }),
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
        expect(result.error.code).toBe("DOCUMENT_NOT_FOUND");
        expect(result.error.meta?.correlationId).toBe("corr-404");
      }
    });
  });

  describe("other errors", () => {
    it("handles generic error responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "Internal server error",
          code: "SERVER_ERROR",
        }),
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
        expect(result.error.message).toBe("Internal server error");
        expect(result.error.code).toBe("SERVER_ERROR");
      }
    });

    it("handles non-JSON error responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(502);
        expect(result.error.message).toContain("502");
      }
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.code).toBe("NETWORK_ERROR");
        expect(result.error.message).toBe("Network timeout");
      }
    });

    it("handles non-Error throws", async () => {
      mockFetch.mockRejectedValueOnce("Something went wrong");

      const result = await getDocument(mockSession, mockParams, mockOptions);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.code).toBe("NETWORK_ERROR");
        expect(result.error.message).toBe("Network error");
      }
    });
  });

  describe("URL construction", () => {
    it("constructs correct URL for SANDBOX", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        text: () => Promise.resolve("{}"),
      });

      await getDocument(mockSession, mockParams, mockOptions);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("preprod-api.myinvois.hasil.gov.my"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/documents/${mockParams.uuid}/raw/${mockParams.longId}`),
        expect.any(Object)
      );
    });

    it("constructs correct URL for PROD", async () => {
      mockSession.env = "PROD";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        text: () => Promise.resolve("{}"),
      });

      await getDocument(mockSession, mockParams, mockOptions);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("api.myinvois.hasil.gov.my"),
        expect.any(Object)
      );
    });
  });

  describe("rate limiter integration", () => {
    it("consumes rate limit when limiter is provided", async () => {
      const mockRateLimiter = {
        consume: vi.fn().mockReturnValue({ allowed: true, limit: 100, remaining: 99 }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({}),
        text: () => Promise.resolve("{}"),
      });

      await getDocument(mockSession, mockParams, {
        ...mockOptions,
        rateLimiter: mockRateLimiter as any,
      });

      expect(mockRateLimiter.consume).toHaveBeenCalledWith(
        mockSession.clientId,
        expect.anything() // Rate limit config (number or object)
      );
    });
  });
});
