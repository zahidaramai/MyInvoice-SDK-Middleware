/**
 * OpenAPI Contract Tests
 *
 * Validates gateway responses conform to the OpenAPI specification.
 *
 * NOTE: These tests are SKIPPED if openapi/openapi.yaml does not exist.
 * The OpenAPI spec is optional for the KLCubeLHDN project as it uses custom endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { buildApp } from "../../apps/gateway/src/app.js";
import type { FastifyInstance } from "fastify";
import { validateResponse, loadSpec, getSpecPath, specExists } from "./validator.js";
import { startMockServer, stopMockServer, resetMockServer, mockState } from "../msw/server.js";
import { createTaxpayerSession } from "../fixtures/sessions.js";
import { createDocumentPayload } from "../fixtures/documents.js";

// Skip all tests if OpenAPI spec doesn't exist
const SKIP_REASON = "OpenAPI spec file not found (openapi/openapi.yaml)";
const shouldSkip = !specExists();

describe.skipIf(shouldSkip)("OpenAPI Contract Tests", () => {
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

  describe("Spec Validation", () => {
    it("loads the OpenAPI spec successfully", () => {
      const spec = loadSpec();
      expect(spec.openapi).toBe("3.0.3");
      expect(spec.info.title).toBeDefined();
    });

    it("uses the canonical spec path", () => {
      const path = getSpecPath();
      expect(path).toContain("openapi/openapi.yaml");
    });
  });

  describe("Health Endpoints", () => {
    it("GET /healthz conforms to spec", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/healthz",
      });

      expect(response.statusCode).toBe(200);
      validateResponse({
        method: "GET",
        path: "/healthz",
        status: 200,
        body: response.json(),
      });
    });

    it("GET /readyz conforms to spec", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/readyz",
      });

      expect(response.statusCode).toBe(200);
      validateResponse({
        method: "GET",
        path: "/readyz",
        status: 200,
        body: response.json(),
      });
    });

    it("GET /version conforms to spec", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/version",
      });

      expect(response.statusCode).toBe(200);
      validateResponse({
        method: "GET",
        path: "/version",
        status: 200,
        body: response.json(),
      });
    });
  });

  describe("Sessions Endpoints", () => {
    it("POST /v1/sessions success conforms to spec", async () => {
      const payload = createTaxpayerSession();

      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload,
      });

      expect(response.statusCode).toBe(201);
      validateResponse({
        method: "POST",
        path: "/v1/sessions",
        status: 201,
        body: response.json(),
      });
    });

    it("POST /v1/sessions 400 error conforms to spec", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: { invalid: "payload" },
      });

      expect(response.statusCode).toBe(400);
      validateResponse({
        method: "POST",
        path: "/v1/sessions",
        status: 400,
        body: response.json(),
      });
    });

    it("GET /v1/sessions/{sessionId} conforms to spec", async () => {
      // Create session first
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });
      const { id: sessionId } = createResponse.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(200);
      validateResponse({
        method: "GET",
        path: "/v1/sessions/{sessionId}",
        status: 200,
        body: response.json(),
      });
    });

    it("GET /v1/sessions/{sessionId} 404 conforms to spec", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/sessions/sess_nonexistent",
      });

      expect(response.statusCode).toBe(404);
      validateResponse({
        method: "GET",
        path: "/v1/sessions/{sessionId}",
        status: 404,
        body: response.json(),
      });
    });

    it("DELETE /v1/sessions/{sessionId} conforms to spec", async () => {
      // Create session first
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });
      const { id: sessionId } = createResponse.json();

      const response = await app.inject({
        method: "DELETE",
        url: `/v1/sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(204);
      // 204 has no body to validate
    });
  });

  describe("Submissions Endpoints", () => {
    let sessionId: string;

    beforeAll(async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });
      sessionId = response.json().id;
    });

    it("POST /v1/submissions 202 conforms to spec", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { sessionId, documents: [createDocumentPayload("INV-CONTRACT-001")] },
      });

      expect(response.statusCode).toBe(202);
      validateResponse({
        method: "POST",
        path: "/v1/submissions",
        status: 202,
        body: response.json(),
      });
    });

    it("POST /v1/submissions 400 conforms to spec", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { sessionId, invalid: "payload" },
      });

      expect(response.statusCode).toBe(400);
      validateResponse({
        method: "POST",
        path: "/v1/submissions",
        status: 400,
        body: response.json(),
      });
    });

    it("GET /v1/submissions/{trackingId} 200 conforms to spec", async () => {
      // Create submission first
      const submitResponse = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { sessionId, documents: [createDocumentPayload("INV-CONTRACT-002")] },
      });
      const { trackingId } = submitResponse.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/submissions/${trackingId}`,
      });

      expect(response.statusCode).toBe(200);
      validateResponse({
        method: "GET",
        path: "/v1/submissions/{trackingId}",
        status: 200,
        body: response.json(),
      });
    });

    it("GET /v1/submissions/{trackingId} 404 conforms to spec", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/submissions/trk_nonexistent",
      });

      expect(response.statusCode).toBe(404);
      validateResponse({
        method: "GET",
        path: "/v1/submissions/{trackingId}",
        status: 404,
        body: response.json(),
      });
    });
  });

  describe("TIN Validate Endpoint", () => {
    let sessionId: string;

    beforeAll(async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(),
      });
      sessionId = response.json().id;

      // Add a valid TIN to mock state
      mockState.addValidTin({
        tin: "C12345678901",
        idType: "BRN",
        idValue: "202001234567",
        valid: true,
        name: "Test Company Sdn Bhd",
      });
    });

    it("GET /v1/tin/validate 200 (valid) conforms to spec", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(200);
      validateResponse({
        method: "GET",
        path: "/v1/tin/validate",
        status: 200,
        body: response.json(),
      });
    });

    it("GET /v1/tin/validate 200 (invalid TIN) conforms to spec", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=INVALID123&idType=BRN&idValue=999999999999&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.valid).toBe(false);
      validateResponse({
        method: "GET",
        path: "/v1/tin/validate",
        status: 200,
        body,
      });
    });

    it("GET /v1/tin/validate 400 conforms to spec", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/tin/validate?tin=ABC&sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(400);
      validateResponse({
        method: "GET",
        path: "/v1/tin/validate",
        status: 400,
        body: response.json(),
      });
    });
  });
});
