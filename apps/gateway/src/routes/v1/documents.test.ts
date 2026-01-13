import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { resetInstances } from "../../lib/myinvois.js";
import { disconnectPrisma, resetPrismaClient } from "@myinvois/storage";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Document Routes", () => {
  let app: FastifyInstance;
  let sessionId: string;

  beforeEach(async () => {
    // Reset all mocks and instances
    mockFetch.mockReset();
    resetInstances();
    sessionStore.clear();

    // Create test session
    const session = sessionStore.create({
      env: "SANDBOX",
      mode: "TAXPAYER",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    sessionId = session.sessionId;

    // Mock login response
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/connect/token")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ correlationid: "test-corr-id" }),
          json: async () => ({
            access_token: "test-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        } as Response;
      }
      // Default mock for other requests
      return {
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ message: "Not mocked" }),
      } as Response;
    });

    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sessionStore.clear();
    resetPrismaClient();
    await disconnectPrisma();
  });

  describe("POST /v1/documents/:uuid/cancel", () => {
    const validUuid = "12345678-1234-1234-1234-123456789012";

    it("returns 400 for invalid UUID format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/documents/invalid-uuid/cancel",
        payload: {
          sessionId,
          reason: "Test cancellation",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_UUID");
    });

    it("returns 400 for missing sessionId", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          reason: "Test cancellation",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_SESSION_ID");
    });

    it("returns 400 for invalid sessionId format", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId: "invalid-format",
          reason: "Test cancellation",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_SESSION_ID");
    });

    it("returns 404 for non-existent session", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId: "sess_nonexistent123",
          reason: "Test cancellation",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("SESSION_NOT_FOUND");
    });

    it("returns 400 for missing reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("MISSING_REASON");
    });

    it("returns 400 for empty reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId,
          reason: "   ",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("MISSING_REASON");
    });

    it("returns 400 for reason exceeding max length", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId,
          reason: "x".repeat(501),
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("REASON_TOO_LONG");
    });

    it("returns 200 on successful cancellation", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "auth-corr-id" }),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "cancel-corr-id" }),
            json: async () => ({
              uuid: validUuid,
              status: "cancelled",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId,
          reason: "Duplicate invoice",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.uuid).toBe(validUuid);
      expect(body.status).toBe("cancelled");
      expect(response.headers["x-correlation-id"]).toBe("cancel-corr-id");
    });

    it("returns 404 when document not found", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: false,
            status: 404,
            headers: new Headers({ correlationid: "not-found-corr-id" }),
            json: async () => ({
              message: "Document not found",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId,
          reason: "Test cancellation",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("DOCUMENT_NOT_FOUND");
    });

    it("returns 429 on rate limit from upstream", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({
              correlationid: "rate-corr-id",
              "retry-after": "60",
            }),
            json: async () => ({
              message: "Too many requests",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId,
          reason: "Test cancellation",
        },
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
    });

    it("returns 400 on validation error (e.g., outside 72-hour window)", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: false,
            status: 400,
            headers: new Headers({ correlationid: "validation-corr-id" }),
            json: async () => ({
              code: "OutsideCancellationWindow",
              message: "Document cannot be cancelled after 72 hours",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId,
          reason: "Test cancellation",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.messageEN).toContain("72 hours");
    });
  });

  describe("POST /v1/documents/:uuid/reject", () => {
    const validUuid = "12345678-1234-1234-1234-123456789012";

    it("returns 400 for invalid UUID format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/documents/invalid-uuid/reject",
        payload: {
          sessionId,
          reason: "Test rejection",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_UUID");
    });

    it("returns 400 for missing sessionId", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/reject`,
        payload: {
          reason: "Test rejection",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_SESSION_ID");
    });

    it("returns 404 for non-existent session", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/reject`,
        payload: {
          sessionId: "sess_nonexistent123",
          reason: "Test rejection",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("SESSION_NOT_FOUND");
    });

    it("returns 400 for missing reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/reject`,
        payload: {
          sessionId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("MISSING_REASON");
    });

    it("returns 200 on successful rejection", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "auth-corr-id" }),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "reject-corr-id" }),
            json: async () => ({
              uuid: validUuid,
              status: "rejected",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/reject`,
        payload: {
          sessionId,
          reason: "Incorrect amount",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.uuid).toBe(validUuid);
      expect(body.status).toBe("rejected");
      expect(response.headers["x-correlation-id"]).toBe("reject-corr-id");
    });

    it("returns 404 when document not found", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: false,
            status: 404,
            headers: new Headers(),
            json: async () => ({
              message: "Document not found",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/reject`,
        payload: {
          sessionId,
          reason: "Test rejection",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("DOCUMENT_NOT_FOUND");
    });

    it("returns 403 when not the receiver", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: false,
            status: 403,
            headers: new Headers({ correlationid: "forbidden-corr-id" }),
            json: async () => ({
              message: "Only the receiver can reject this document",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/reject`,
        payload: {
          sessionId,
          reason: "Test rejection",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("returns 429 on rate limit from upstream", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({
              correlationid: "rate-corr-id",
              "retry-after": "60",
            }),
            json: async () => ({
              message: "Too many requests",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/reject`,
        payload: {
          sessionId,
          reason: "Test rejection",
        },
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
    });
  });

  describe("GET /v1/documents/:uuid/details", () => {
    const validUuid = "12345678-1234-1234-1234-123456789012";

    it("returns 400 for invalid UUID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/invalid-uuid/details?sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_UUID");
    });

    it("returns 400 for missing sessionId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${validUuid}/details`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_SESSION_ID");
    });

    it("returns 400 for invalid sessionId format", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${validUuid}/details?sessionId=invalid-format`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_SESSION_ID");
    });

    it("returns 404 for non-existent session", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${validUuid}/details?sessionId=sess_nonexistent123`,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("SESSION_NOT_FOUND");
    });

    it("returns 200 with document details on success", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "auth-corr-id" }),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/") && url.includes("/details")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "details-corr-id" }),
            json: async () => ({
              uuid: validUuid,
              submissionUid: "sub_12345678",
              longId: "LONG123456789",
              internalId: "INV-001",
              typeName: "invoice",
              issuerTin: "C12345678901",
              issuerName: "Test Issuer Sdn Bhd",
              receiverId: "C98765432109",
              receiverName: "Test Receiver Sdn Bhd",
              dateTimeIssued: "2024-01-15T10:30:00Z",
              dateTimeReceived: "2024-01-15T10:31:00Z",
              dateTimeValidated: "2024-01-15T10:32:00Z",
              totalPayableAmount: 1000.50,
              status: "valid",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${validUuid}/details?sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.uuid).toBe(validUuid);
      expect(body.longId).toBe("LONG123456789");
      expect(body.internalId).toBe("INV-001");
      expect(body.status).toBe("valid");
      expect(body.dateTimeIssued).toBe("2024-01-15T10:30:00.000Z");
      expect(body.dateTimeReceived).toBe("2024-01-15T10:31:00.000Z");
      expect(body.dateTimeValidated).toBe("2024-01-15T10:32:00.000Z");
      expect(response.headers["x-correlation-id"]).toBe("details-corr-id");
    });

    it("returns 404 when document not found", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/") && url.includes("/details")) {
          return {
            ok: false,
            status: 404,
            headers: new Headers({ correlationid: "not-found-corr-id" }),
            json: async () => ({
              message: "Document not found",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${validUuid}/details?sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("DOCUMENT_NOT_FOUND");
    });

    it("returns 429 on rate limit from upstream", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/") && url.includes("/details")) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({
              correlationid: "rate-corr-id",
              "retry-after": "60",
            }),
            json: async () => ({
              message: "Too many requests",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${validUuid}/details?sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
    });
  });

  describe("correlationId handling", () => {
    const validUuid = "12345678-1234-1234-1234-123456789012";

    it("returns correlationId header on success", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "test-corr-id" }),
            json: async () => ({
              uuid: validUuid,
              status: "cancelled",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        payload: {
          sessionId,
          reason: "Test cancellation",
        },
      });

      expect(response.headers["x-correlation-id"]).toBeDefined();
    });

    it("returns correlationId header on error", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/invalid-uuid/cancel`,
        payload: {
          sessionId,
          reason: "Test cancellation",
        },
      });

      expect(response.headers["correlationid"]).toBeDefined();
    });

    it("uses provided x-correlation-id", async () => {
      const customId = "custom-correlation-id-123";
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/connect/token")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          } as Response;
        }
        if (url.includes("/documents/state/")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: customId }),
            json: async () => ({
              uuid: validUuid,
              status: "cancelled",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${validUuid}/cancel`,
        headers: {
          "x-correlation-id": customId,
        },
        payload: {
          sessionId,
          reason: "Test cancellation",
        },
      });

      expect(response.headers["x-correlation-id"]).toBe(customId);
    });
  });
});
