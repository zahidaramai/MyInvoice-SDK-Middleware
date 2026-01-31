/**
 * Actual tests for getDocumentDetails that import and test the real function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDocumentDetails } from "../../src/einvoice/getDocumentDetails.js";
import type { SessionCredentials } from "../../src/types.js";
import { TokenManager } from "../../src/tokenManager.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock TokenManager
vi.mock("../../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("getDocumentDetails (actual)", () => {
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

  describe("successful retrieval", () => {
    it("returns document details on 200 response", async () => {
      const upstreamResponse = {
        uuid: "test-uuid",
        submissionUid: "sub-123",
        longId: "long-id-123",
        internalId: "INV001",
        typeName: "invoice",
        issuerTin: "C12345678901",
        issuerName: "Test Company",
        receiverId: "C98765432100",
        receiverName: "Buyer Company",
        dateTimeIssued: "2024-01-15T10:00:00Z",
        dateTimeReceived: "2024-01-15T10:05:00Z",
        dateTimeValidated: "2024-01-15T10:10:00Z",
        totalPayableAmount: 106.00,
        status: "Valid",
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.uuid).toBe("test-uuid");
        expect(result.result.submissionUid).toBe("sub-123");
        expect(result.result.longId).toBe("long-id-123");
        expect(result.result.internalId).toBe("INV001");
        expect(result.result.issuerTin).toBe("C12345678901");
        expect(result.result.issuerName).toBe("Test Company");
        expect(result.result.receiverId).toBe("C98765432100");
        expect(result.result.receiverName).toBe("Buyer Company");
        expect(result.result.dateTimeIssued).toBeInstanceOf(Date);
        expect(result.result.totalPayableAmount).toBe("106");
        expect(result.result.status).toBe("Valid");
        expect(result.result.meta.correlationId).toBe("corr-123");
      }
    });

    it("handles missing optional fields", async () => {
      const upstreamResponse = {
        uuid: "test-uuid",
        submissionUid: "sub-123",
        internalId: "INV001",
        typeName: "invoice",
        issuerTin: "C12345678901",
        status: "Valid",
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.longId).toBeNull();
        expect(result.result.issuerName).toBeNull();
        expect(result.result.receiverId).toBeNull();
        expect(result.result.receiverName).toBeNull();
        expect(result.result.dateTimeIssued).toBeNull();
        expect(result.result.totalPayableAmount).toBeNull();
        expect(result.result.statusReason).toBeNull();
      }
    });

    it("handles cancelled document", async () => {
      const upstreamResponse = {
        uuid: "test-uuid",
        submissionUid: "sub-123",
        internalId: "INV001",
        typeName: "invoice",
        issuerTin: "C12345678901",
        status: "Cancelled",
        cancelDateTime: "2024-01-16T12:00:00Z",
        documentStatusReason: "Customer request",
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.status).toBe("Cancelled");
        expect(result.result.cancelDateTime).toBeInstanceOf(Date);
        expect(result.result.statusReason).toBe("Customer request");
      }
    });

    it("handles rejected document", async () => {
      const upstreamResponse = {
        uuid: "test-uuid",
        submissionUid: "sub-123",
        internalId: "INV001",
        typeName: "invoice",
        issuerTin: "C12345678901",
        status: "Rejected",
        rejectDateTime: "2024-01-16T12:00:00Z",
        documentStatusReason: "Invalid data",
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.status).toBe("Rejected");
        expect(result.result.rejectDateTime).toBeInstanceOf(Date);
      }
    });

    it("handles invalid date strings gracefully", async () => {
      const upstreamResponse = {
        uuid: "test-uuid",
        submissionUid: "sub-123",
        internalId: "INV001",
        typeName: "invoice",
        issuerTin: "C12345678901",
        status: "Valid",
        dateTimeIssued: "invalid-date",
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.dateTimeIssued).toBeNull();
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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
        submissionUid: "sub-123",
        internalId: "INV001",
        typeName: "invoice",
        issuerTin: "C12345678901",
        status: "Valid",
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "non-existent" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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

      const result = await getDocumentDetails(
        mockSession,
        { uuid: "test-uuid" },
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
        json: () => Promise.resolve({
          uuid: "test-uuid",
          submissionUid: "sub-123",
          internalId: "INV001",
          typeName: "invoice",
          issuerTin: "C12345678901",
          status: "Valid",
        }),
      });

      await getDocumentDetails(
        intermediarySession,
        { uuid: "test-uuid" },
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
    it("constructs correct URL with uuid", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({
          uuid: "abc-123",
          submissionUid: "sub-123",
          internalId: "INV001",
          typeName: "invoice",
          issuerTin: "C12345678901",
          status: "Valid",
        }),
      });

      await getDocumentDetails(
        mockSession,
        { uuid: "abc-123" },
        { tokenManager: mockTokenManager }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1.0/documents/abc-123/details"),
        expect.any(Object)
      );
    });
  });
});
