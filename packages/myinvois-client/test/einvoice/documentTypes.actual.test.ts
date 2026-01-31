/**
 * Actual tests for documentTypes that import and test the real functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAllDocumentTypes,
  getDocumentTypeById,
  getDocumentTypeVersionById,
} from "../../src/einvoice/documentTypes.js";
import type { SessionCredentials } from "../../src/types.js";
import { TokenManager } from "../../src/tokenManager.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock TokenManager
vi.mock("../../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("documentTypes (actual)", () => {
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

  describe("getAllDocumentTypes", () => {
    it("returns document types on successful response (array format)", async () => {
      const upstreamResponse = [
        {
          id: 1,
          invoiceTypeCode: 1,
          description: "Invoice",
          activeFrom: "2024-01-01",
          documentTypeVersions: [
            {
              id: 1,
              name: "1.0",
              description: "Invoice version 1.0",
              versionNumber: 1,
              status: "published",
            },
          ],
        },
        {
          id: 2,
          invoiceTypeCode: 2,
          description: "Credit Note",
          documentTypeVersions: [],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          correlationid: "corr-123",
          "x-rate-limit-limit": "300",
          "x-rate-limit-remaining": "299",
        }),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documentTypes).toHaveLength(2);
        expect(result.result.documentTypes[0].id).toBe(1);
        expect(result.result.documentTypes[0].description).toBe("Invoice");
        expect(result.result.documentTypes[0].documentTypeVersions).toHaveLength(1);
        expect(result.result.meta.correlationId).toBe("corr-123");
        expect(result.result.meta.rateLimitLimit).toBe(300);
        expect(result.result.meta.rateLimitRemaining).toBe(299);
      }
    });

    it("returns document types on successful response (object with result format)", async () => {
      const upstreamResponse = {
        result: [
          {
            id: 1,
            invoiceTypeCode: 1,
            description: "Invoice",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documentTypes).toHaveLength(1);
        expect(result.result.documentTypes[0].id).toBe(1);
      }
    });

    it("handles empty result", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve([]),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documentTypes).toHaveLength(0);
      }
    });

    it("handles object without result property", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({}),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documentTypes).toHaveLength(0);
      }
    });

    it("returns error when token acquisition fails", async () => {
      mockTokenManager.getToken = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          status: 401,
          message: "Invalid credentials",
          code: "LOGIN_FAILED",
        },
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("handles error response with message and code", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ "x-correlation-id": "corr-500" }),
        json: () =>
          Promise.resolve({
            message: "Internal server error",
            code: "SERVER_ERROR",
          }),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
        expect(result.error.message).toBe("Internal server error");
        expect(result.error.code).toBe("SERVER_ERROR");
        expect(result.error.meta?.correlationId).toBe("corr-500");
      }
    });

    it("handles error response without message or code", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({}),
        json: () => Promise.resolve({}),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
        expect(result.error.message).toContain("400");
        expect(result.error.code).toBe("UPSTREAM_ERROR");
      }
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers({}),
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(502);
        expect(result.error.message).toContain("502");
      }
    });

    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.code).toBe("NETWORK_ERROR");
        expect(result.error.message).toBe("Network timeout");
      }
    });

    it("handles non-Error throw", async () => {
      mockFetch.mockRejectedValueOnce("Unknown error");

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Network error");
      }
    });
  });

  describe("getDocumentTypeById", () => {
    it("returns document type on successful response", async () => {
      const upstreamResponse = {
        id: 1,
        invoiceTypeCode: 1,
        description: "Invoice",
        activeFrom: "2024-01-01",
        activeTo: "2025-12-31",
        documentTypeVersions: [
          {
            id: 1,
            name: "1.0",
            versionNumber: 1,
            status: "published",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          correlationid: "corr-123",
        }),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getDocumentTypeById(mockSession, 1, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.documentType.id).toBe(1);
        expect(result.result.documentType.description).toBe("Invoice");
        expect(result.result.documentType.activeFrom).toBe("2024-01-01");
        expect(result.result.documentType.activeTo).toBe("2025-12-31");
        expect(result.result.meta.correlationId).toBe("corr-123");
      }
    });

    it("constructs correct URL with document type ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ id: 42, invoiceTypeCode: 42, description: "Test" }),
      });

      await getDocumentTypeById(mockSession, 42, { tokenManager: mockTokenManager });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1.0/documenttypes/42"),
        expect.any(Object)
      );
    });

    it("returns error when token acquisition fails", async () => {
      mockTokenManager.getToken = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          status: 401,
          message: "Token expired",
          code: "AUTH_TOKEN_EXPIRED",
        },
      });

      const result = await getDocumentTypeById(mockSession, 1, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AUTH_TOKEN_EXPIRED");
      }
    });

    it("handles 404 not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({}),
        json: () =>
          Promise.resolve({
            message: "Document type not found",
            code: "NOT_FOUND",
          }),
      });

      const result = await getDocumentTypeById(mockSession, 999, {
        tokenManager: mockTokenManager,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await getDocumentTypeById(mockSession, 1, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NETWORK_ERROR");
        expect(result.error.message).toBe("Connection refused");
      }
    });

    it("handles non-Error throw", async () => {
      mockFetch.mockRejectedValueOnce({ some: "object" });

      const result = await getDocumentTypeById(mockSession, 1, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Network error");
      }
    });
  });

  describe("getDocumentTypeVersionById", () => {
    it("returns version on successful response", async () => {
      const upstreamResponse = {
        id: 1,
        name: "1.1",
        description: "Invoice version 1.1",
        activeFrom: "2024-01-01",
        activeTo: "2025-12-31",
        versionNumber: 2,
        status: "published",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          correlationid: "corr-version",
          "x-rate-limit-remaining": "150",
        }),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getDocumentTypeVersionById(mockSession, 1, 1, {
        tokenManager: mockTokenManager,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.version.id).toBe(1);
        expect(result.result.version.name).toBe("1.1");
        expect(result.result.version.versionNumber).toBe(2);
        expect(result.result.version.status).toBe("published");
        expect(result.result.meta.correlationId).toBe("corr-version");
        expect(result.result.meta.rateLimitRemaining).toBe(150);
      }
    });

    it("constructs correct URL with type ID and version ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve({ id: 5, name: "1.0", versionNumber: 1, status: "published" }),
      });

      await getDocumentTypeVersionById(mockSession, 10, 5, { tokenManager: mockTokenManager });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1.0/documenttypes/10/versions/5"),
        expect.any(Object)
      );
    });

    it("handles version with optional fields missing", async () => {
      const upstreamResponse = {
        id: 1,
        name: "1.0",
        versionNumber: 1,
        status: "draft",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve(upstreamResponse),
      });

      const result = await getDocumentTypeVersionById(mockSession, 1, 1, {
        tokenManager: mockTokenManager,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.version.status).toBe("draft");
        expect(result.result.version.description).toBeUndefined();
        expect(result.result.version.activeFrom).toBeUndefined();
      }
    });

    it("returns error when token acquisition fails", async () => {
      mockTokenManager.getToken = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          status: 401,
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        },
      });

      const result = await getDocumentTypeVersionById(mockSession, 1, 1, {
        tokenManager: mockTokenManager,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNAUTHORIZED");
      }
    });

    it("handles error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({}),
        json: () =>
          Promise.resolve({
            message: "Invalid version ID",
            code: "INVALID_VERSION",
          }),
      });

      const result = await getDocumentTypeVersionById(mockSession, 1, 999, {
        tokenManager: mockTokenManager,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
        expect(result.error.code).toBe("INVALID_VERSION");
      }
    });

    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("DNS resolution failed"));

      const result = await getDocumentTypeVersionById(mockSession, 1, 1, {
        tokenManager: mockTokenManager,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NETWORK_ERROR");
      }
    });

    it("handles non-Error throw", async () => {
      mockFetch.mockRejectedValueOnce(null);

      const result = await getDocumentTypeVersionById(mockSession, 1, 1, {
        tokenManager: mockTokenManager,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Network error");
      }
    });
  });

  describe("metadata extraction", () => {
    it("extracts correlationid header (lowercase)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ correlationid: "lower-case-id" }),
        json: () => Promise.resolve([]),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.meta.correlationId).toBe("lower-case-id");
      }
    });

    it("extracts x-correlation-id header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "x-correlation-id": "x-prefixed-id" }),
        json: () => Promise.resolve([]),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.meta.correlationId).toBe("x-prefixed-id");
      }
    });

    it("extracts rate limit headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "x-rate-limit-limit": "100",
          "x-rate-limit-remaining": "50",
        }),
        json: () => Promise.resolve([]),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.meta.rateLimitLimit).toBe(100);
        expect(result.result.meta.rateLimitRemaining).toBe(50);
      }
    });

    it("handles missing headers gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: () => Promise.resolve([]),
      });

      const result = await getAllDocumentTypes(mockSession, { tokenManager: mockTokenManager });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.meta.correlationId).toBeUndefined();
        expect(result.result.meta.rateLimitLimit).toBeUndefined();
        expect(result.result.meta.rateLimitRemaining).toBeUndefined();
      }
    });
  });
});
