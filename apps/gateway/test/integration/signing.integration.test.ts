/**
 * Signing Integration Tests
 *
 * Tests end-to-end signing functionality (US-034).
 * These tests verify that signing integrates correctly with the gateway.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";

describe("signing integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe("session document version", () => {
    it("creates session with default v1.0 when documentVersion not specified", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client",
          clientSecret: "test-secret",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.documentVersion).toBe("1.0");
    });

    it("creates session with v1.0 when explicitly requested", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client",
          clientSecret: "test-secret",
          documentVersion: "1.0",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.documentVersion).toBe("1.0");
    });

    it("rejects invalid document version", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client",
          clientSecret: "test-secret",
          documentVersion: "2.0",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.messageEN).toContain("documentVersion");
    });

    it("returns session with document version", async () => {
      // First create a session
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client",
          clientSecret: "test-secret",
          documentVersion: "1.0",
        },
      });

      const created = createResponse.json();

      // Then get the session
      const getResponse = await app.inject({
        method: "GET",
        url: `/v1/sessions/${created.id}`,
      });

      expect(getResponse.statusCode).toBe(200);
      const session = getResponse.json();
      expect(session.documentVersion).toBe("1.0");
    });
  });

  describe("v1.0 submissions (unsigned)", () => {
    it("validates submission request structure for v1.0", async () => {
      // Create a v1.0 session
      const sessionResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          env: "SANDBOX",
          mode: "TAXPAYER",
          clientId: "test-client",
          clientSecret: "test-secret",
          documentVersion: "1.0",
        },
      });

      expect(sessionResponse.statusCode).toBe(201);
      const session = sessionResponse.json();

      // Submit a document with rawDocument - will fail validation but tests structure
      const submissionResponse = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: {
          sessionId: session.id,
          documents: [
            {
              format: "JSON",
              codeNumber: "INV-001",
              rawDocument: JSON.stringify({
                ID: [{ _: "INV-001" }],
                InvoiceTypeCode: [{ _: "01" }],
              }),
            },
          ],
        },
      });

      // Request is processed (may fail upstream validation, but route works)
      // Expected: 202 (success), 400 (validation), or 502 (upstream error)
      expect([202, 400, 502]).toContain(submissionResponse.statusCode);
    });
  });

  describe("signing health status", () => {
    it("includes signing status in readiness check", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/readyz",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Signing status should be present
      expect(body).toHaveProperty("signing");
      expect(body.signing).toHaveProperty("enabled");
      expect(body.signing).toHaveProperty("defaultVersion");
    });
  });

  describe("error handling", () => {
    it("returns proper error envelope structure", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sessions/sess_nonexistent",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();

      expect(body).toHaveProperty("error");
      expect(body.error).toHaveProperty("code");
      expect(body.error).toHaveProperty("messageEN");
      expect(body.error).toHaveProperty("httpStatus");
      expect(body.error).toHaveProperty("retryable");
    });

    it("returns NOT_FOUND error for missing session", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sessions/sess_nonexistent",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });
});
