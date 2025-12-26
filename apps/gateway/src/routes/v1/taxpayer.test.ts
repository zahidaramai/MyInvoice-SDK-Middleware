import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { resetInstances } from "../../lib/myinvois.js";
import { disconnectPrisma, resetPrismaClient } from "@myinvois/storage";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Taxpayer Routes", () => {
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

  describe("GET /v1/tin/validate", () => {
    it("returns 400 for missing sessionId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/tin/validate?tin=C12345&idType=BRN&idValue=123456",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.errorCode).toBe("INVALID_SESSION_ID");
    });

    it("returns 400 for invalid sessionId format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/tin/validate?sessionId=invalid&tin=C12345&idType=BRN&idValue=123456",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.errorCode).toBe("INVALID_SESSION_ID");
    });

    it("returns 404 for non-existent session", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/tin/validate?sessionId=sess_nonexistent&tin=C12345&idType=BRN&idValue=123456",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.errorCode).toBe("SESSION_NOT_FOUND");
    });

    it("returns 400 for missing TIN", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&idType=BRN&idValue=123456`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.errorCode).toBe("MISSING_TIN");
    });

    it("returns 400 for empty TIN", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=&idType=BRN&idValue=123456`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.errorCode).toBe("MISSING_TIN");
    });

    it("returns 400 for invalid idType", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345&idType=INVALID&idValue=123456`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.errorCode).toBe("INVALID_ID_TYPE");
    });

    it("returns 400 for missing idValue", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345&idType=BRN`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.errorCode).toBe("MISSING_ID_VALUE");
    });

    it("returns 200 with valid=true when TIN is valid", async () => {
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
        if (url.includes("/taxpayer/validate/")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "validate-corr-id" }),
            json: async () => ({
              name: "Test Company Sdn Bhd",
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
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=BRN&idValue=123456`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tin).toBe("C12345678901");
      expect(body.valid).toBe(true);
      expect(body.name).toBe("Test Company Sdn Bhd");
      expect(body.cached).toBe(false);
      expect(response.headers["x-correlation-id"]).toBe("validate-corr-id");
      expect(response.headers["x-cache"]).toBe("MISS");
      expect(response.headers["x-cache-ttl"]).toBeDefined();
    });

    it("returns 200 with valid=false when TIN is not found (404)", async () => {
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
        if (url.includes("/taxpayer/validate/")) {
          return {
            ok: false,
            status: 404,
            headers: new Headers({ correlationid: "notfound-corr-id" }),
            json: async () => ({}),
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
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C99999999999&idType=NRIC&idValue=990101-14-5678`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tin).toBe("C99999999999");
      expect(body.valid).toBe(false);
      expect(body.name).toBeUndefined();
      expect(body.cached).toBe(false);
    });

    it("returns cache HIT on second request", async () => {
      // First request - cache MISS
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
        if (url.includes("/taxpayer/validate/")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "first-corr-id" }),
            json: async () => ({ name: "Cached Company Sdn Bhd" }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const firstResponse = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=BRN&idValue=CACHE123`,
      });

      expect(firstResponse.statusCode).toBe(200);
      expect(firstResponse.headers["x-cache"]).toBe("MISS");
      const firstBody = firstResponse.json();
      expect(firstBody.cached).toBe(false);

      // Reset mock to NOT return from upstream - this ensures we're using cache
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/taxpayer/validate/")) {
          throw new Error("Should not call upstream on cache HIT");
        }
        // Allow token calls
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
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      // Second request - should be cache HIT
      const secondResponse = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=BRN&idValue=CACHE123`,
      });

      expect(secondResponse.statusCode).toBe(200);
      expect(secondResponse.headers["x-cache"]).toBe("HIT");
      const secondBody = secondResponse.json();
      expect(secondBody.tin).toBe("C12345678901");
      expect(secondBody.valid).toBe(true);
      expect(secondBody.name).toBe("Cached Company Sdn Bhd");
      expect(secondBody.cached).toBe(true);
    });

    it("bypasses cache when forceRefresh=1", async () => {
      // First populate cache
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
        if (url.includes("/taxpayer/validate/")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "validate-corr-id" }),
            json: async () => ({ name: "Original Company" }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=PASSPORT&idValue=A12345678`,
      });

      // Now force refresh - should call upstream again
      let upstreamCalled = false;
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
        if (url.includes("/taxpayer/validate/")) {
          upstreamCalled = true;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "refresh-corr-id" }),
            json: async () => ({ name: "Updated Company" }),
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
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=PASSPORT&idValue=A12345678&forceRefresh=1`,
      });

      expect(response.statusCode).toBe(200);
      expect(upstreamCalled).toBe(true);
      expect(response.headers["x-cache"]).toBe("MISS");
      const body = response.json();
      expect(body.name).toBe("Updated Company");
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
        if (url.includes("/taxpayer/validate/")) {
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
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=BRN&idValue=RATE123`,
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
      expect(response.headers["x-cache"]).toBe("MISS");
    });

    it("normalizes TIN to uppercase", async () => {
      let capturedUrl = "";
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
        if (url.includes("/taxpayer/validate/")) {
          capturedUrl = url;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "validate-corr-id" }),
            json: async () => ({}),
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
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=c12345678901&idType=brn&idValue=123456`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tin).toBe("C12345678901");
      // Verify the URL was normalized
      expect(capturedUrl).toContain("C12345678901");
      expect(capturedUrl).toContain("idType=BRN");
    });

    it("accepts all valid idType values", async () => {
      const idTypes = ["NRIC", "PASSPORT", "BRN", "ARMY"];

      for (const idType of idTypes) {
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
          if (url.includes("/taxpayer/validate/")) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ correlationid: "test-corr-id" }),
              json: async () => ({}),
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
          url: `/v1/tin/validate?sessionId=${sessionId}&tin=C123${idType}&idType=${idType}&idValue=TEST${idType}`,
        });

        expect(response.statusCode).toBe(200);
      }
    });
  });

  describe("Privacy assertions", () => {
    it("does not store raw idValue in cache (verified by different hash for different values)", async () => {
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
        if (url.includes("/taxpayer/validate/")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "test-corr-id" }),
            json: async () => ({ name: "Test Co" }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      // First request with idValue "SECRET1"
      const response1 = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=BRN&idValue=SECRET1`,
      });
      expect(response1.statusCode).toBe(200);

      // Second request with same TIN but different idValue should call upstream (cache miss)
      let upstreamCalled = false;
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
        if (url.includes("/taxpayer/validate/")) {
          upstreamCalled = true;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "test-corr-id" }),
            json: async () => ({ name: "Test Co" }),
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: "Not mocked" }),
        } as Response;
      });

      const response2 = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=BRN&idValue=SECRET2`,
      });
      expect(response2.statusCode).toBe(200);
      expect(upstreamCalled).toBe(true); // Different idValue = different hash = cache miss
    });
  });

  describe("correlationId handling", () => {
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
        if (url.includes("/taxpayer/validate/")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ correlationid: "test-corr-id" }),
            json: async () => ({}),
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
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345&idType=BRN&idValue=123`,
      });

      expect(response.headers["x-correlation-id"]).toBeDefined();
    });

    it("returns correlationId header on error", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=sess_invalid&tin=C12345&idType=BRN&idValue=123`,
      });

      expect(response.headers["correlationid"]).toBeDefined();
    });
  });
});
