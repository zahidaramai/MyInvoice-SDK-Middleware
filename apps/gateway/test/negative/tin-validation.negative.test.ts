/**
 * Negative Tests - TIN Validation
 *
 * Tests error handling for TIN validation endpoint.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import {
  startMockServer,
  stopMockServer,
  resetMockServer,
  useMockHandlers,
  negativeHandlers,
} from "../../../../test/msw/server.js";
import { createTaxpayerSession } from "../../../../test/fixtures/sessions.js";
import { ErrorCodes } from "@myinvois/core";

describe("Negative Tests: TIN Validation", () => {
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

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: createTaxpayerSession(),
    });
    sessionId = response.json().id;
  });

  afterEach(() => {
    resetMockServer();
  });

  describe("TIN Not Found", () => {
    it("returns NOT_FOUND for invalid TIN", async () => {
      useMockHandlers(negativeHandlers.tinNotFound);

      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C00000000000&idType=NRIC&idValue=123456789012`,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.retryable).toBe(false);
    });
  });

  describe("Rate Limiting", () => {
    it("returns 429 with Retry-After when rate limited", async () => {
      useMockHandlers(negativeHandlers.tinRateLimit);

      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=NRIC&idValue=123456789012`,
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();

      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.retryable).toBe(true);
    });
  });

  describe("Missing Parameters", () => {
    it("returns validation error for missing idType", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idValue=123456789012`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it("returns validation error for missing idValue", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?sessionId=${sessionId}&tin=C12345678901&idType=NRIC`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it("requires session ID header", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/tin/validate?tin=C12345678901&idType=NRIC&idValue=123456789012",
        // Missing x-session-id
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
