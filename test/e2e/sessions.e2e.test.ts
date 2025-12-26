/**
 * E2E Tests - Sessions
 *
 * Tests session creation, retrieval, and deletion flows.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { buildApp } from "../../apps/gateway/src/app.js";
import type { FastifyInstance } from "fastify";
import { startMockServer, stopMockServer, resetMockServer } from "../msw/server.js";
import { createTaxpayerSession, createIntermediarySession } from "../fixtures/sessions.js";

describe("E2E: Sessions", () => {
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
      expect(body.sessionId).toMatch(/^sess_/);
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
      expect(body.sessionId).toMatch(/^sess_/);
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
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createIntermediarySession({ onBehalfOf: "C12345678901:ROB123456" }),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().onBehalfOf).toBe("C12345678901:ROB123456");
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
      const { sessionId } = createResponse.json();

      // Get session
      const response = await app.inject({
        method: "GET",
        url: `/v1/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.sessionId).toBe(sessionId);
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
      expect(body.httpStatus).toBe(404);
      expect(body.errorCode).toBeDefined();
    });

    it("returns 400 for invalid session ID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sessions/invalid-format",
      });

      expect(response.statusCode).toBe(400);
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
      const { sessionId } = createResponse.json();

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
    it("returns X-Correlation-Id header", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });

      expect(response.headers["x-correlation-id"]).toBeDefined();
    });

    it("echoes client-provided correlation ID", async () => {
      const correlationId = "test-correlation-123";

      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "x-correlation-id": correlationId },
        payload: createTaxpayerSession(),
      });

      expect(response.headers["x-correlation-id"]).toBe(correlationId);
    });
  });
});
