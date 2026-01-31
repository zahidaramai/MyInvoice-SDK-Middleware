/**
 * Actual tests for searchDocuments that import and test the real function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchDocuments } from "../../src/einvoice/searchDocuments.js";
import type { SessionCredentials } from "../../src/types.js";
import { TokenManager } from "../../src/tokenManager.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock TokenManager
vi.mock("../../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("searchDocuments (actual)", () => {
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

  describe("successful search", () => {
    it("returns documents on successful response", async () => {
      const upstreamResponse = {
        result: [
          {
            uuid: "uuid-1",
            submissionUid: "sub-1",
            longId: "long-id-1",
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
          },
        ],
        metadata: {
          totalPages: 5,
          totalCount: 50,
          continuationToken: "next-token-123",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          correlationid: "corr-123",
        }),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await searchDocuments(
        mockSession,
        { pageNo: 1, pageSize: 10 },
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documents).toHaveLength(1);
        expect(result.result.documents[0].uuid).toBe("uuid-1");
        expect(result.result.documents[0].internalId).toBe("INV001");
        expect(result.result.documents[0].dateTimeIssued).toBeInstanceOf(Date);
        expect(result.result.documents[0].totalPayableAmount).toBe("106");
        expect(result.result.totalPages).toBe(5);
        expect(result.result.totalCount).toBe(50);
        expect(result.result.continuationToken).toBe("next-token-123");
        expect(result.result.meta.correlationId).toBe("corr-123");
      }
    });

    it("handles empty result", async () => {
      const upstreamResponse = {
        result: [],
        metadata: {
          totalPages: 0,
          totalCount: 0,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await searchDocuments(
        mockSession,
        {},
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documents).toHaveLength(0);
        expect(result.result.totalPages).toBe(0);
        expect(result.result.totalCount).toBe(0);
      }
    });

    it("handles missing metadata", async () => {
      const upstreamResponse = {
        result: [
          {
            uuid: "uuid-1",
            submissionUid: "sub-1",
            internalId: "INV001",
            typeName: "invoice",
            issuerTin: "C12345678901",
            status: "Valid",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await searchDocuments(
        mockSession,
        {},
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.totalPages).toBeNull();
        expect(result.result.totalCount).toBeNull();
        expect(result.result.continuationToken).toBeNull();
      }
    });

    it("handles missing optional document fields", async () => {
      const upstreamResponse = {
        result: [
          {
            uuid: "uuid-1",
            submissionUid: "sub-1",
            internalId: "INV001",
            typeName: "invoice",
            issuerTin: "C12345678901",
            status: "Valid",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await searchDocuments(
        mockSession,
        {},
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documents[0].longId).toBeNull();
        expect(result.result.documents[0].issuerName).toBeNull();
        expect(result.result.documents[0].receiverId).toBeNull();
        expect(result.result.documents[0].receiverName).toBeNull();
        expect(result.result.documents[0].typeVersionName).toBeNull();
        expect(result.result.documents[0].dateTimeIssued).toBeNull();
        expect(result.result.documents[0].totalPayableAmount).toBeNull();
      }
    });

    it("handles documents with cancel/reject dates", async () => {
      const upstreamResponse = {
        result: [
          {
            uuid: "uuid-1",
            submissionUid: "sub-1",
            internalId: "INV001",
            typeName: "invoice",
            issuerTin: "C12345678901",
            status: "Cancelled",
            cancelDateTime: "2024-01-16T12:00:00Z",
          },
          {
            uuid: "uuid-2",
            submissionUid: "sub-2",
            internalId: "INV002",
            typeName: "invoice",
            issuerTin: "C12345678901",
            status: "Rejected",
            rejectDateTime: "2024-01-16T14:00:00Z",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await searchDocuments(
        mockSession,
        {},
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documents[0].cancelDateTime).toBeInstanceOf(Date);
        expect(result.result.documents[1].rejectDateTime).toBeInstanceOf(Date);
      }
    });
  });

  describe("query parameters", () => {
    it("includes all filter parameters in URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ result: [] }),
      });

      await searchDocuments(
        mockSession,
        {
          uuid: "test-uuid",
          submissionUid: "sub-123",
          pageNo: 2,
          pageSize: 20,
          submissionDateFrom: "2024-01-01",
          submissionDateTo: "2024-01-31",
          continuationToken: "token-123",
          issueDateFrom: "2024-01-01",
          issueDateTo: "2024-01-31",
          direction: "Sent",
          status: "Valid",
          documentType: "invoice",
          receiverId: "C98765432100",
          receiverTin: "C98765432100",
          issuerTin: "C12345678901",
        },
        { tokenManager: mockTokenManager }
      );

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("uuid=test-uuid");
      expect(callUrl).toContain("submissionUid=sub-123");
      expect(callUrl).toContain("pageNo=2");
      expect(callUrl).toContain("pageSize=20");
      expect(callUrl).toContain("submissionDateFrom=2024-01-01");
      expect(callUrl).toContain("submissionDateTo=2024-01-31");
      expect(callUrl).toContain("continuationToken=token-123");
      expect(callUrl).toContain("issueDateFrom=2024-01-01");
      expect(callUrl).toContain("issueDateTo=2024-01-31");
      expect(callUrl).toContain("direction=Sent");
      expect(callUrl).toContain("status=Valid");
      expect(callUrl).toContain("documentType=invoice");
      expect(callUrl).toContain("receiverId=C98765432100");
      expect(callUrl).toContain("receiverTin=C98765432100");
      expect(callUrl).toContain("issuerTin=C12345678901");
    });

    it("handles empty params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ result: [] }),
      });

      await searchDocuments(
        mockSession,
        {},
        { tokenManager: mockTokenManager }
      );

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("/api/v1.0/documents/search");
      expect(callUrl).not.toContain("=");
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

      const result = await searchDocuments(
        mockSession,
        {},
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

      const result = await searchDocuments(
        mockSession,
        {},
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

      const result = await searchDocuments(
        mockSession,
        {},
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("attempts token refresh on 401 and retries successfully", async () => {
      const upstreamResponse = {
        result: [],
      };

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
          json: () => Promise.resolve(upstreamResponse),
        });

      const result = await searchDocuments(
        mockSession,
        {},
        { tokenManager: mockTokenManager }
      );

      expect(mockTokenManager.refreshToken).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it("returns unauthorized when refresh fails or retry fails", async () => {
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

      const result = await searchDocuments(
        mockSession,
        {},
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(401);
        expect(result.error.code).toBe("UNAUTHORIZED");
      }
    });
  });

  describe("network errors", () => {
    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await searchDocuments(
        mockSession,
        {},
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

      const result = await searchDocuments(
        mockSession,
        {},
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

      const result = await searchDocuments(
        mockSession,
        {},
        { tokenManager: mockTokenManager }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
        expect(result.error.code).toBe("SERVER_ERROR");
      }
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await searchDocuments(
        mockSession,
        {},
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
    it("includes onbehalfof header for session with onBehalfOf", async () => {
      const sessionWithOnBehalf: SessionCredentials = {
        ...mockSession,
        onBehalfOf: "C98765432100",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ result: [] }),
      });

      await searchDocuments(
        sessionWithOnBehalf,
        {},
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
});
