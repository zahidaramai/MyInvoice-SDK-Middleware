/**
 * Actual tests for identity module that import and test the real function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { login } from "../src/identity.js";
import type { SessionCredentials } from "../src/types.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("identity (actual)", () => {
  let mockSession: SessionCredentials;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSession = {
      sessionId: "test-session-id",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      env: "SANDBOX",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful login", () => {
    it("returns token on successful response", async () => {
      const tokenResponse = {
        access_token: "test-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          correlationid: "corr-123",
          "x-rate-limit-limit": "12",
          "x-rate-limit-remaining": "11",
        }),
        json: () => Promise.resolve(tokenResponse),
      });

      const result = await login(mockSession);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.token.accessToken).toBe("test-access-token");
        expect(result.token.expiresAtMs).toBeGreaterThan(Date.now());
        expect(result.meta.correlationId).toBe("corr-123");
        expect(result.meta.rateLimitLimit).toBe(12);
        expect(result.meta.rateLimitRemaining).toBe(11);
      }
    });

    it("uses default scope InvoicingAPI", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      await login(mockSession);

      const callBody = mockFetch.mock.calls[0][1].body as string;
      expect(callBody).toContain("scope=InvoicingAPI");
    });

    it("uses custom scope if provided", async () => {
      const sessionWithScope: SessionCredentials = {
        ...mockSession,
        scope: "CustomScope",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      await login(sessionWithScope);

      const callBody = mockFetch.mock.calls[0][1].body as string;
      expect(callBody).toContain("scope=CustomScope");
    });

    it("applies renewSkewMs to expiration calculation", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      const renewSkewMs = 60000; // 1 minute
      const beforeCall = Date.now();

      const result = await login(mockSession, { renewSkewMs });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Token should expire roughly: now + 3600*1000 - 60000 = now + 3540000
        const expectedExpiry = beforeCall + 3600 * 1000 - renewSkewMs;
        expect(result.token.expiresAtMs).toBeLessThanOrEqual(expectedExpiry + 100);
        expect(result.token.expiresAtMs).toBeGreaterThan(expectedExpiry - 100);
      }
    });

    it("sends correct Content-Type header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      await login(mockSession);

      const callHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders["Content-Type"]).toBe("application/x-www-form-urlencoded");
    });

    it("sends correct form body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      await login(mockSession);

      const callBody = mockFetch.mock.calls[0][1].body as string;
      expect(callBody).toContain("client_id=test-client-id");
      expect(callBody).toContain("client_secret=test-client-secret");
      expect(callBody).toContain("grant_type=client_credentials");
    });
  });

  describe("intermediary mode", () => {
    it("includes onbehalfof header in intermediary mode", async () => {
      const intermediarySession: SessionCredentials = {
        ...mockSession,
        mode: "INTERMEDIARY",
        onBehalfOf: "C98765432100",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      await login(intermediarySession);

      const callHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders.onbehalfof).toBe("C98765432100");
    });

    it("does not include onbehalfof without intermediary mode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      await login(mockSession);

      const callHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders.onbehalfof).toBeUndefined();
    });

    it("does not include onbehalfof without onBehalfOf value", async () => {
      const sessionWithMode: SessionCredentials = {
        ...mockSession,
        mode: "INTERMEDIARY",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      await login(sessionWithMode);

      const callHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders.onbehalfof).toBeUndefined();
    });
  });

  describe("rate limiting", () => {
    it("returns rate limit error when local limiter blocks", async () => {
      const mockRateLimiter = {
        consume: vi.fn().mockReturnValue({
          allowed: false,
          limit: 12,
          remaining: 0,
        }),
      };

      const result = await login(mockSession, { rateLimiter: mockRateLimiter as any });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(result.error.meta?.rateLimitLimit).toBe(12);
        expect(result.error.meta?.rateLimitRemaining).toBe(0);
      }
    });

    it("proceeds when rate limiter allows", async () => {
      const mockRateLimiter = {
        consume: vi.fn().mockReturnValue({
          allowed: true,
          limit: 12,
          remaining: 11,
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      const result = await login(mockSession, { rateLimiter: mockRateLimiter as any });

      expect(result.ok).toBe(true);
      expect(mockRateLimiter.consume).toHaveBeenCalledWith(mockSession.clientId, expect.any(Number));
    });
  });

  describe("error responses", () => {
    it("returns error on 401 with error_description", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({}),
        json: () => Promise.resolve({
          error: "invalid_client",
          error_description: "Client credentials are invalid",
        }),
      });

      const result = await login(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(401);
        expect(result.error.code).toBe("INVALID_CREDENTIALS");
        expect(result.error.message).toBe("Client credentials are invalid");
      }
    });

    it("returns error on 401 with error field only", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({}),
        json: () => Promise.resolve({
          error: "invalid_client",
        }),
      });

      const result = await login(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_CREDENTIALS");
        expect(result.error.message).toBe("invalid_client");
      }
    });

    it("returns error on 429 upstream rate limit", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ correlationid: "corr-429" }),
        json: () => Promise.resolve({
          error: "rate_limit",
          error_description: "Too many requests",
        }),
      });

      const result = await login(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("UPSTREAM_RATE_LIMIT");
      }
    });

    it("returns LOGIN_FAILED for other status codes", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({}),
        json: () => Promise.resolve({
          error_description: "Server error",
        }),
      });

      const result = await login(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await login(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(502);
        expect(result.error.message).toBe("Login failed");
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });
  });

  describe("network errors", () => {
    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await login(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.code).toBe("NETWORK_ERROR");
        expect(result.error.message).toBe("Network timeout");
      }
    });

    it("handles non-Error throw", async () => {
      mockFetch.mockRejectedValueOnce("Unknown error");

      const result = await login(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Network error");
        expect(result.error.code).toBe("NETWORK_ERROR");
      }
    });

    it("handles timeout abort error", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await login(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.code).toBe("IDENTITY_TIMEOUT");
        expect(result.error.message).toContain("timeout");
      }
    });
  });

  describe("URL construction", () => {
    it("uses SANDBOX identity URL for SANDBOX env", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      await login(mockSession);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("preprod");
      expect(callUrl).toContain("/connect/token");
    });

    it("uses PROD identity URL for PROD env", async () => {
      const prodSession: SessionCredentials = {
        ...mockSession,
        env: "PROD",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      await login(prodSession);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).not.toContain("preprod");
      expect(callUrl).toContain("/connect/token");
    });
  });

  describe("metadata extraction", () => {
    it("extracts all upstream meta headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          correlationid: "corr-123",
          "x-rate-limit-limit": "12",
          "x-rate-limit-remaining": "10",
        }),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      const result = await login(mockSession);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.meta.correlationId).toBe("corr-123");
        expect(result.meta.rateLimitLimit).toBe(12);
        expect(result.meta.rateLimitRemaining).toBe(10);
      }
    });

    it("handles x-correlation-id header variant", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "x-correlation-id": "x-corr-456",
        }),
        json: () => Promise.resolve({
          access_token: "test-token",
          expires_in: 3600,
        }),
      });

      const result = await login(mockSession);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.meta.correlationId).toBe("x-corr-456");
      }
    });

    it("includes meta in error responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({
          correlationid: "error-corr-id",
          "x-rate-limit-remaining": "5",
        }),
        json: () => Promise.resolve({
          error: "invalid_client",
        }),
      });

      const result = await login(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.meta?.correlationId).toBe("error-corr-id");
        expect(result.error.meta?.rateLimitRemaining).toBe(5);
      }
    });
  });
});
