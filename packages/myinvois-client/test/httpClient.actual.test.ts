/**
 * Actual tests for MyInvoisHttpClient that import and test the real class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MyInvoisHttpClient, createHttpClient } from "../src/httpClient.js";
import type { SessionCredentials } from "../src/types.js";
import { TokenManager } from "../src/tokenManager.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock TokenManager
vi.mock("../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("MyInvoisHttpClient (actual)", () => {
  let mockTokenManager: TokenManager;
  let mockSession: SessionCredentials;
  let client: MyInvoisHttpClient;

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

    // Create client with minimal retry config for faster tests
    client = new MyInvoisHttpClient({
      tokenManager: mockTokenManager,
      retry: {
        maxRetries: 0, // No retries for unit tests
        initialBackoffMs: 1,
        backoffMultiplier: 1,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful requests", () => {
    it("makes GET request successfully", async () => {
      const responseData = { id: "123", name: "test" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          correlationid: "corr-123",
        }),
        json: () => Promise.resolve(responseData),
      });

      const result = await client.request<typeof responseData>(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(responseData);
        expect(result.status).toBe(200);
      }
    });

    it("makes POST request successfully", async () => {
      const requestBody = { documents: [{ format: "JSON", document: "{}" }] };
      const responseData = { submissionUid: "sub-123" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Headers({}),
        json: () => Promise.resolve(responseData),
      });

      const result = await client.request<typeof responseData>(mockSession, {
        method: "POST",
        path: "/api/v1.0/documentsubmissions/",
        body: requestBody,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(responseData);
      }
    });

    it("handles 204 No Content response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({}),
      });

      const result = await client.request<void>(mockSession, {
        method: "DELETE",
        path: "/api/v1.0/documents/123",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBeUndefined();
      }
    });
  });

  describe("authentication", () => {
    it("adds authorization header when authRequired", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({}),
      });

      await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
        authRequired: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-access-token",
          }),
        })
      );
    });

    it("returns error when token acquisition fails", async () => {
      mockTokenManager.getToken = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          status: 401,
          message: "Invalid credentials",
          code: "LOGIN_FAILED",
          meta: { correlationId: "corr-401" },
        },
      });

      const result = await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error?.code).toBe("LOGIN_FAILED");
      }
    });

    it("refreshes token on 401 and retries", async () => {
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
          json: () => Promise.resolve({ success: true }),
        });

      const result = await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(mockTokenManager.refreshToken).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it("returns error when retry after refresh fails", async () => {
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
          json: () => Promise.resolve({ message: "Forbidden" }),
        });

      const result = await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(403);
      }
    });
  });

  describe("rate limiting", () => {
    it("returns rate limit error on 429", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({
          "retry-after": "60",
        }),
      });

      const result = await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(429);
        expect(result.error?.code).toBe("UPSTREAM_RATE_LIMIT");
      }
    });

    it("does not retry on 429", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({}),
      });

      await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("error response parsing", () => {
    it("parses error with message field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "Invalid request body",
          code: "INVALID_BODY",
        }),
      });

      const result = await client.request(mockSession, {
        method: "POST",
        path: "/api/v1.0/documentsubmissions/",
        body: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error?.message).toBe("Invalid request body");
        expect(result.error?.code).toBe("INVALID_BODY");
      }
    });

    it("parses error with error field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({}),
        json: () => Promise.resolve({
          error: "Something went wrong",
        }),
      });

      const result = await client.request(mockSession, {
        method: "POST",
        path: "/api/v1.0/documentsubmissions/",
        body: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error?.message).toBe("Something went wrong");
      }
    });

    it("parses error with details array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          details: [
            { code: "Error1", message: "First error", propertyPath: "field1" },
            { code: "Error2", message: "Second error", target: "value2" },
          ],
        }),
      });

      const result = await client.request(mockSession, {
        method: "POST",
        path: "/api/v1.0/documentsubmissions/",
        body: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error?.details).toHaveLength(2);
      }
    });

    it("parses error with innerError array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "Error",
          innerError: [
            { code: "Inner1", message: "Inner error" },
          ],
        }),
      });

      const result = await client.request(mockSession, {
        method: "POST",
        path: "/api/v1.0/documentsubmissions/",
        body: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error?.details).toBeDefined();
      }
    });

    it("parses error with propertyName and propertyPath", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({}),
        json: () => Promise.resolve({
          message: "Field error",
          propertyName: "TaxTotal",
          propertyPath: "Invoice/TaxTotal",
          target: "100.00",
        }),
      });

      const result = await client.request(mockSession, {
        method: "POST",
        path: "/api/v1.0/documentsubmissions/",
        body: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error?.details).toBeDefined();
        expect(result.error?.details?.[0].propertyName).toBe("TaxTotal");
      }
    });
  });

  describe("client error handling", () => {
    it("does not retry on 4xx client error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({}),
        json: () => Promise.resolve({ message: "Bad request" }),
      });

      const result = await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
    });

    it("does not retry POST request on 5xx error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({}),
        json: () => Promise.resolve({ message: "Server error" }),
      });

      const result = await client.request(mockSession, {
        method: "POST",
        path: "/api/v1.0/documentsubmissions/",
        body: { documents: [] },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
    });
  });

  describe("metrics hooks", () => {
    it("calls onUpstreamRequestStart hook", async () => {
      const metricsHooks = {
        onUpstreamRequestStart: vi.fn(),
        onUpstreamRequestEnd: vi.fn(),
      };

      const clientWithMetrics = new MyInvoisHttpClient({
        tokenManager: mockTokenManager,
        metricsHooks,
        retry: { maxRetries: 0, initialBackoffMs: 1, backoffMultiplier: 1 },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({}),
      });

      await clientWithMetrics.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123?param=value",
      });

      expect(metricsHooks.onUpstreamRequestStart).toHaveBeenCalledWith(
        "/api/v1.0/documents/123",
        "GET"
      );
    });

    it("calls onUpstreamRequestEnd hook", async () => {
      const metricsHooks = {
        onUpstreamRequestStart: vi.fn(),
        onUpstreamRequestEnd: vi.fn(),
      };

      const clientWithMetrics = new MyInvoisHttpClient({
        tokenManager: mockTokenManager,
        metricsHooks,
        retry: { maxRetries: 0, initialBackoffMs: 1, backoffMultiplier: 1 },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({}),
      });

      await clientWithMetrics.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(metricsHooks.onUpstreamRequestEnd).toHaveBeenCalledWith(
        "/api/v1.0/documents/123",
        "GET",
        200,
        expect.any(Number)
      );
    });

    it("calls onUpstreamRateLimited hook on 429", async () => {
      const metricsHooks = {
        onUpstreamRateLimited: vi.fn(),
      };

      const clientWithMetrics = new MyInvoisHttpClient({
        tokenManager: mockTokenManager,
        metricsHooks,
        retry: { maxRetries: 0, initialBackoffMs: 1, backoffMultiplier: 1 },
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({}),
      });

      await clientWithMetrics.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(metricsHooks.onUpstreamRateLimited).toHaveBeenCalledWith("/api/v1.0/documents/123");
    });
  });

  describe("createHttpClient factory", () => {
    it("creates client instance", () => {
      const newClient = createHttpClient({
        tokenManager: mockTokenManager,
      });

      expect(newClient).toBeInstanceOf(MyInvoisHttpClient);
    });
  });

  describe("content-type handling", () => {
    it("sets Content-Type for request body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({}),
      });

      await client.request(mockSession, {
        method: "POST",
        path: "/api/v1.0/documentsubmissions/",
        body: { documents: [] },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("does not override existing Content-Type", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({}),
      });

      await client.request(mockSession, {
        method: "POST",
        path: "/api/v1.0/documentsubmissions/",
        body: { documents: [] },
        headers: { "Content-Type": "application/xml" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/xml",
          }),
        })
      );
    });
  });

  describe("URL construction", () => {
    it("constructs full URL from session env and path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({}),
      });

      await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/abc-123",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1.0/documents/abc-123"),
        expect.any(Object)
      );
    });
  });

  describe("metadata extraction", () => {
    it("extracts correlation ID from headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          correlationid: "test-correlation-id",
        }),
        json: () => Promise.resolve({}),
      });

      const result = await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.meta.correlationId).toBe("test-correlation-id");
      }
    });

    it("extracts rate limit headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "x-rate-limit-limit": "100",
          "x-rate-limit-remaining": "99",
          "x-rate-limit-reset": "1700000000",
        }),
        json: () => Promise.resolve({}),
      });

      const result = await client.request(mockSession, {
        method: "GET",
        path: "/api/v1.0/documents/123",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.meta.rateLimitLimit).toBe(100);
        expect(result.meta.rateLimitRemaining).toBe(99);
        expect(result.meta.rateLimitReset).toBe(1700000000);
      }
    });
  });
});
