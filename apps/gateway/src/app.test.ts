import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("Gateway App", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("Health endpoints", () => {
    it("GET /healthz returns status ok", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/healthz",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok" });
    });

    it("GET /readyz returns status with checks", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/readyz",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe("ok");
      expect(body.checks).toBeDefined();
      expect(body.checks.database).toBe("ok");
      expect(body.checks.redis).toBe("ok");
    });

    it("GET /version returns name and version", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/version",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe("@myinvois/gateway");
      expect(body.version).toBeDefined();
    });
  });

  describe("CorrelationId", () => {
    it("returns correlationId header on success", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/healthz",
      });

      expect(response.headers["correlationid"]).toBeDefined();
      expect(typeof response.headers["correlationid"]).toBe("string");
    });

    it("uses incoming x-correlation-id if provided", async () => {
      const customId = "test-correlation-123";
      const response = await app.inject({
        method: "GET",
        url: "/healthz",
        headers: {
          "x-correlation-id": customId,
        },
      });

      expect(response.headers["correlationid"]).toBe(customId);
    });

    it("returns correlationId header on 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/nonexistent-route",
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers["correlationid"]).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("404 returns ErrorEnvelope shape", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/nonexistent-route",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.httpStatus).toBe(404);
      expect(body.error.message).toContain("not found");
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("TIN validation endpoint", () => {
    // TIN validation is implemented in Phase 07 - routes/v1/taxpayer.ts
    // These tests verify basic behavior; detailed tests in taxpayer.test.ts

    it("GET /v1/tin/validate returns 404 for non-existent session", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/tin/validate?sessionId=sess_nonexistent&tin=C12345&idType=BRN&idValue=123456",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("SESSION_NOT_FOUND");
    });

    it("GET /v1/tin/validate returns 400 for invalid sessionId format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/tin/validate?sessionId=invalid&tin=C12345&idType=BRN&idValue=123456",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_SESSION_ID");
    });
  });

  describe("Poll endpoint", () => {
    it("POST /v1/submissions/:trackingId/poll returns 404 for non-existent submission", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions/trk_nonexistent/poll",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("SUBMISSION_NOT_FOUND");
    });

    it("poll endpoint includes correlationId header", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions/trk_test123/poll",
      });

      expect(response.headers["correlationid"]).toBeDefined();
    });
  });
});
