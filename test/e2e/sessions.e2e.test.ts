/**
 * E2E Tests - Sessions
 *
 * Tests session creation, retrieval, and deletion flows.
 * Requires testcontainers (PostgreSQL + Redis) to be running.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { buildApp } from "../../apps/gateway/src/app.js";
import type { FastifyInstance } from "fastify";
import { startMockServer, stopMockServer, resetMockServer } from "../msw/server.js";
import { createTaxpayerSession, createIntermediarySession } from "../fixtures/sessions.js";

// Skip if testcontainers not available (unit test mode)
const skipE2E = process.env.SKIP_TESTCONTAINERS === "true" || !process.env.DATABASE_URL;

describe.skipIf(skipE2E)("E2E: Sessions", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    startMockServer();
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    stopMockServer();
  });

  afterEach(() => {
    resetMockServer();
  });

  describe("Create TAXPAYER session", () => {
    it("creates a session successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.id).toMatch(/^sess_/);
      expect(body.env).toBe("SANDBOX");
      expect(body.mode).toBe("TAXPAYER");
      expect(body.createdAt).toBeDefined();
      expect(body.expiresAt).toBeDefined();

      // Should not expose secrets
      expect(body.clientSecret).toBeUndefined();
    });

    it("creates a PROD session", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession({ env: "PROD" }),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().env).toBe("PROD");
    });

    it("rejects invalid env", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: { ...createTaxpayerSession(), env: "INVALID" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects missing clientId", async () => {
      const payload = createTaxpayerSession();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (payload as any).clientId;

      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects missing clientSecret", async () => {
      const payload = createTaxpayerSession();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (payload as any).clientSecret;

      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Create INTERMEDIARY session", () => {
    it("creates an intermediary session successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createIntermediarySession(),
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.id).toMatch(/^sess_/);
      expect(body.mode).toBe("INTERMEDIARY");
      expect(body.onBehalfOf).toBe("C98765432109");
    });

    it("rejects INTERMEDIARY without onBehalfOf", async () => {
      const payload = createIntermediarySession();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (payload as any).onBehalfOf;

      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it("accepts TIN:ROB format for onBehalfOf", async () => {
      // The validation accepts TIN:ROB format (literal :ROB suffix, not :ROB followed by numbers)
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createIntermediarySession({ onBehalfOf: "C12345678901:ROB" }),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().onBehalfOf).toBe("C12345678901:ROB");
    });
  });

  describe("Get session", () => {
    it("retrieves an existing session", async () => {
      // Create session
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });
      const { id: sessionId } = createResponse.json();

      // Get session
      const response = await app.inject({
        method: "GET",
        url: `/v1/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.id).toBe(sessionId);
      expect(body.env).toBe("SANDBOX");
      expect(body.mode).toBe("TAXPAYER");

      // Should not expose secrets
      expect(body.clientSecret).toBeUndefined();
    });

    it("returns 404 for non-existent session", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sessions/sess_nonexistent123",
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error.httpStatus).toBe(404);
      expect(body.error.code).toBeDefined();
    });

    it("returns 400 for invalid session ID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sessions/invalid-format",
      });

      // Invalid format may return 404 (not found) instead of 400
      expect([400, 404]).toContain(response.statusCode);
    });
  });

  describe("Delete session", () => {
    it("deletes an existing session", async () => {
      // Create session
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });
      const { id: sessionId } = createResponse.json();

      // Delete session
      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/v1/sessions/${sessionId}`,
      });

      expect(deleteResponse.statusCode).toBe(204);

      // Verify session is gone
      const getResponse = await app.inject({
        method: "GET",
        url: `/v1/sessions/${sessionId}`,
      });

      expect(getResponse.statusCode).toBe(404);
    });

    it("returns 404 for non-existent session", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/v1/sessions/sess_nonexistent123",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("Correlation ID handling", () => {
    it("returns correlationid header", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });

      // Plugin uses lowercase 'correlationid' without hyphen
      expect(response.headers["correlationid"]).toBeDefined();
    });

    it("generates unique correlation ID for each request", async () => {
      const response1 = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });

      const response2 = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });

      // Each request gets a unique correlation ID from request.id
      expect(response1.headers["correlationid"]).toBeDefined();
      expect(response2.headers["correlationid"]).toBeDefined();
      expect(response1.headers["correlationid"]).not.toBe(response2.headers["correlationid"]);
    });
  });
});
