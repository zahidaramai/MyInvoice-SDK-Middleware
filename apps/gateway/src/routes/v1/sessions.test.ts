import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { resetInstances } from "../../lib/myinvois.js";

describe("Sessions Routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sessionStore.clear();
    resetInstances();
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sessionStore.stop();
  });

  describe("POST /v1/sessions", () => {
    it("creates a TAXPAYER session and returns 201", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers["correlationid"]).toBeDefined();

      const body = response.json();
      expect(body.id).toMatch(/^sess_/);
      expect(body.env).toBe("SANDBOX");
      expect(body.mode).toBe("TAXPAYER");
      expect(body.createdAt).toBeDefined();
      expect(body.expiresAt).toBeDefined();
      expect(body.onBehalfOf).toBeUndefined();
    });

    it("creates an INTERMEDIARY session with onBehalfOf", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "PROD",
          mode: "INTERMEDIARY",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          onBehalfOf: "C12345678901",
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.mode).toBe("INTERMEDIARY");
      expect(body.onBehalfOf).toBe("C12345678901");
    });

    it("accepts TIN:ROB format for onBehalfOf", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "INTERMEDIARY",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          onBehalfOf: "C12345678901:ROB",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.onBehalfOf).toBe("C12345678901:ROB");
    });

    it("returns 400 for invalid env", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "INVALID",
          mode: "TAXPAYER",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.errorCode).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid mode", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "INVALID",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.errorCode).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when INTERMEDIARY missing onBehalfOf", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "INTERMEDIARY",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.messageEN).toContain("onBehalfOf is required");
    });

    it("returns 400 when TAXPAYER has onBehalfOf", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          onBehalfOf: "C12345678901",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.messageEN).toContain("not allowed for TAXPAYER");
    });

    it("returns 400 for missing clientId", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientSecret: "test-client-secret",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.propertyPath).toBe("clientId");
    });

    it("returns 400 for missing clientSecret", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client-id",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.propertyPath).toBe("clientSecret");
    });

    it("returns 400 for invalid onBehalfOf format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "INTERMEDIARY",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          onBehalfOf: "invalid",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.messageEN).toContain("valid TIN");
    });
  });

  describe("GET /v1/sessions/:sessionId", () => {
    it("returns session details for existing session", async () => {
      // First create a session
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      const { id } = createResponse.json();

      // Then fetch it
      const response = await app.inject({
        method: "GET",
        url: `/v1/sessions/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(id);
      expect(body.env).toBe("SANDBOX");
      expect(body.mode).toBe("TAXPAYER");
    });

    it("returns 404 for non-existent session", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sessions/sess_nonexistent123",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.errorCode).toBe("NOT_FOUND");
    });

    it("does not expose secrets in response", async () => {
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client-id",
          clientSecret: "super-secret-value",
        },
      });

      const { id } = createResponse.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/sessions/${id}`,
      });

      const body = response.json();
      expect(body.clientSecret).toBeUndefined();
      expect(body.clientId).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("super-secret-value");
    });
  });

  describe("DELETE /v1/sessions/:sessionId", () => {
    it("deletes an existing session and returns 204", async () => {
      // First create a session
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      const { id } = createResponse.json();

      // Delete it
      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/v1/sessions/${id}`,
      });

      expect(deleteResponse.statusCode).toBe(204);
      expect(deleteResponse.headers["correlationid"]).toBeDefined();

      // Verify it's gone
      const getResponse = await app.inject({
        method: "GET",
        url: `/v1/sessions/${id}`,
      });

      expect(getResponse.statusCode).toBe(404);
    });

    it("returns 404 for non-existent session", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/v1/sessions/sess_nonexistent123",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.errorCode).toBe("NOT_FOUND");
    });
  });

  describe("correlationId handling", () => {
    it("returns correlationId header on success", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      expect(response.headers["correlationid"]).toBeDefined();
    });

    it("returns correlationId header on error", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "INVALID",
          mode: "TAXPAYER",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      expect(response.headers["correlationid"]).toBeDefined();
    });

    it("uses provided x-correlation-id", async () => {
      const customId = "custom-correlation-id-123";
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: {
          "x-correlation-id": customId,
        },
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      expect(response.headers["correlationid"]).toBe(customId);
    });
  });
});
