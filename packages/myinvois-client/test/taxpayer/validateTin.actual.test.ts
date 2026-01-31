/**
 * Actual tests for validateTaxpayerTin that import and test the real function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateTaxpayerTin } from "../../src/taxpayer/validateTin.js";
import type { SessionCredentials } from "../../src/types.js";
import { TokenManager } from "../../src/tokenManager.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock TokenManager
vi.mock("../../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("validateTaxpayerTin (actual)", () => {
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

  describe("valid TIN", () => {
    it("returns valid=true on 200 response with name", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({
          correlationid: "corr-123",
          "x-rate-limit-limit": "300",
          "x-rate-limit-remaining": "299",
        }),
        json: () => Promise.resolve({ name: "Test Company Sdn Bhd" }),
      });

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.valid).toBe(true);
        expect(result.result.tin).toBe("C12345678901");
        expect(result.result.name).toBe("Test Company Sdn Bhd");
        expect(result.result.meta.correlationId).toBe("corr-123");
      }
    });

    it("returns valid=true on 200 response without name", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("No JSON")),
      });

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.valid).toBe(true);
        expect(result.result.name).toBeUndefined();
      }
    });
  });

  describe("invalid TIN", () => {
    it("returns valid=false on 404 response", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        headers: new Headers({
          correlationid: "corr-404",
        }),
      });

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C99999999999", idType: "BRN", idValue: "999999999999" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.valid).toBe(false);
        expect(result.result.tin).toBe("C99999999999");
        expect(result.result.name).toBeUndefined();
        expect(result.result.meta.correlationId).toBe("corr-404");
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager, rateLimiter: mockRateLimiter as any }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(result.error.message).toContain("TIN validation");
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("attempts token refresh on 401 and retries successfully with 200", async () => {
      mockFetch
        .mockResolvedValueOnce({
          status: 401,
          headers: new Headers({}),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: new Headers({}),
          json: () => Promise.resolve({ name: "Test Company" }),
        });

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(mockTokenManager.refreshToken).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.valid).toBe(true);
      }
    });

    it("returns valid=false when retry returns 404", async () => {
      mockFetch
        .mockResolvedValueOnce({
          status: 401,
          headers: new Headers({}),
        })
        .mockResolvedValueOnce({
          status: 404,
          headers: new Headers({}),
        });

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.valid).toBe(false);
      }
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REFRESH_FAILED");
      }
    });

    it("returns error when retry after refresh returns other error", async () => {
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
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
            message: "Invalid idType",
            code: "InvalidIdType",
          }),
      });

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "INVALID", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
        expect(result.error.code).toBe("InvalidIdType");
        expect(result.error.message).toBe("Invalid idType");
      }
    });

    it("handles 400 with non-JSON body", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 400,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "bad" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("network errors", () => {
    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
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
        json: () => Promise.resolve({ name: "Test Company" }),
      });

      await validateTaxpayerTin(
        intermediarySession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
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

  describe("URL construction", () => {
    it("constructs correct URL with encoded parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ name: "Test" }),
      });

      await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("/api/v1.0/taxpayer/validate/C12345678901");
      expect(callUrl).toContain("idType=BRN");
      expect(callUrl).toContain("idValue=202301012345");
    });

    it("encodes special characters in TIN", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ name: "Test" }),
      });

      await validateTaxpayerTin(
        mockSession,
        { tin: "C123+456", idType: "NRIC", idValue: "801025145127" },
        { tokenManager: mockTokenManager }
      );

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("C123%2B456");
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
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

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
    });

    it("uses default retry-after when no headers", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 429,
        headers: new Headers({}),
      });

      const result = await validateTaxpayerTin(
        mockSession,
        { tin: "C12345678901", idType: "BRN", idValue: "202301012345" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.meta?.rateLimitReset).toBeDefined();
      }
    });
  });
});
