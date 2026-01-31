/**
 * E2E Tests - TIN Validation
 *
 * Tests TIN validation with caching and privacy checks.
 * Requires testcontainers (PostgreSQL + Redis) to be running.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { buildApp } from "../../apps/gateway/src/app.js";
import type { FastifyInstance } from "fastify";
import { startMockServer, stopMockServer, resetMockServer, mockState } from "../msw/server.js";
import { createTaxpayerSession } from "../fixtures/sessions.js";

// Skip if testcontainers not available (unit test mode)
const skipE2E = process.env.SKIP_TESTCONTAINERS === "true" || !process.env.DATABASE_URL;

describe.skipIf(skipE2E)("E2E: TIN Validation", () => {
  let app: FastifyInstance;
  let sessionId: string;

  beforeAll(async () => {
    startMockServer();
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    stopMockServer();
  });

  beforeEach(async () => {
    resetMockServer();

    // Create a fresh session
    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: createTaxpayerSession(),
    });
    sessionId = response.json().id;

    // Set up valid TINs in mock state
    mockState.addValidTin({
      tin: "C12345678901",
      idType: "BRN",
      idValue: "202001234567",
      valid: true,
      name: "Valid Company Sdn Bhd",
    });

    mockState.addValidTin({
      tin: "IG12345678901",
      idType: "NRIC",
      idValue: "880101015001",
      valid: true,
      name: "Individual Taxpayer",
    });
  });

  afterEach(() => {
    resetMockServer();
  });

  describe("Validate TIN", () => {
    it("returns valid=true for a valid TIN", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.valid).toBe(true);
      expect(body.tin).toBe("C12345678901");
      expect(body.name).toBe("Valid Company Sdn Bhd");
    });

    it("returns valid=false for an invalid TIN", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=INVALID123&idType=BRN&idValue=999999999999&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.valid).toBe(false);
      expect(body.tin).toBe("INVALID123");
      expect(body.name).toBeUndefined();
    });

    it("validates individual TIN with NRIC", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=IG12345678901&idType=NRIC&idValue=880101015001&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.valid).toBe(true);
      expect(body.name).toBe("Individual Taxpayer");
    });

    it("requires all query parameters", async () => {
      // Missing idValue
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=C12345678901&idType=BRN&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("requires sessionId query param", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567",
      });

      expect(response.statusCode).toBe(400);
    });

    it("validates idType enum", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=C12345678901&idType=INVALID&idValue=202001234567&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("TIN Caching", () => {
    it("caches valid TIN results (MISS then HIT)", async () => {
      // First request - MISS (goes to upstream)
      const response1 = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567&sessionId=${sessionId}`,
      });

      expect(response1.statusCode).toBe(200);
      expect(response1.json().valid).toBe(true);

      // Note: In a full implementation, we'd check X-Cache header
      // For now, just verify the second call also succeeds

      // Second request - should HIT cache (no upstream call)
      // We can verify by setting upstream to rate limited after first call
      mockState.setRateLimited("validateTin");

      const response2 = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567&sessionId=${sessionId}`,
      });

      // If caching works, this should succeed despite rate limit
      // because it hits the cache
      expect(response2.statusCode).toBe(200);
      expect(response2.json().valid).toBe(true);
    });

    it("does not cache across different sessions", async () => {
      // First session validates TIN
      await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567&sessionId=${sessionId}`,
      });

      // Create a new session
      const newSessionResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession({ clientId: "different-client" }),
      });
      const newSessionId = newSessionResponse.json().id;

      // Set rate limit to verify new request goes upstream
      mockState.setRateLimited("validateTin");

      // New session should NOT use cache from first session
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567&sessionId=${newSessionId}`,
      });

      // Should hit rate limit since cache is session-scoped
      expect(response.statusCode).toBe(429);
    });
  });

  describe("Privacy - idValue not stored raw", () => {
    it("does not expose raw idValue in response", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();

      // Response should not contain the raw idValue
      expect(body.idValue).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("202001234567");
    });
  });

  describe("Rate limiting (429)", () => {
    it("handles upstream 429 gracefully", async () => {
      mockState.setRateLimited("validateTin");

      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=NEWTIN123&idType=BRN&idValue=999999999999&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();

      // Error response is wrapped in error envelope
      const body = response.json();
      const httpStatus = body.error?.httpStatus ?? body.httpStatus;
      const retryAfter = body.error?.retryAfterSeconds ?? body.retryAfterSeconds;
      expect(httpStatus).toBe(429);
      expect(retryAfter).toBeDefined();
    });
  });

  describe("Supported ID Types", () => {
    const idTypes = ["NRIC", "PASSPORT", "BRN", "ARMY"];

    idTypes.forEach((idType) => {
      it(`accepts idType=${idType}`, async () => {
        const response = await app.inject({
          method: "GET",
          url: `/v1/tin/validate?tin=TEST123&idType=${idType}&idValue=TESTVALUE&sessionId=${sessionId}`,
        });

        // Should not reject based on idType
        expect(response.statusCode).not.toBe(400);
      });
    });
  });
});
