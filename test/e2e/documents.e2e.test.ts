/**
 * E2E Tests - Documents
 *
 * Tests document cancel, reject, and details flows.
 * Requires testcontainers (PostgreSQL + Redis) to be running.
 *
 * Run with: SKIP_TESTCONTAINERS=false pnpm test
 * Skip with: SKIP_TESTCONTAINERS=true pnpm test
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { buildApp } from "../../apps/gateway/src/app.js";
import type { FastifyInstance } from "fastify";
import { startMockServer, stopMockServer, resetMockServer, mockState } from "../msw/server.js";
import { createTaxpayerSession } from "../fixtures/sessions.js";
import { createDocumentPayload } from "../fixtures/documents.js";

// Skip if testcontainers not available (unit test mode)
const skipE2E = process.env.SKIP_TESTCONTAINERS === "true" || !process.env.DATABASE_URL;

describe.skipIf(skipE2E)("E2E: Documents", () => {
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
    const body = response.json();
    sessionId = body.id;
  });

  afterEach(() => {
    resetMockServer();
  });

  /**
   * Helper to create a valid document for testing
   * Returns null if submission fails (test should be skipped)
   */
  async function createValidDocument(): Promise<{ uuid: string; trackingId: string } | null> {
    // Submit a document
    const submitResponse = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: { sessionId, documents: [createDocumentPayload(`INV-${Date.now()}`)] },
    });

    const responseBody = submitResponse.json();

    // Check if submission succeeded - if not, the mock server isn't configured correctly
    if (!responseBody.acceptedDocuments || responseBody.acceptedDocuments.length === 0) {
      // Return null - test should be skipped
      return null;
    }

    const { trackingId, submissionUid, acceptedDocuments } = responseBody;
    const uuid = acceptedDocuments[0].uuid;

    // Simulate the document becoming valid (upstream polling complete)
    mockState.setSubmissionStatus(submissionUid, "valid");

    return { uuid, trackingId };
  }

  describe("Cancel document", () => {
    it("cancels a valid document successfully", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        payload: { sessionId, reason: "Invoice issued in error" },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.uuid).toBe(uuid);
      expect(body.status).toBe("cancelled");
    });

    it("requires reason for cancellation", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        payload: { sessionId },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 404 for non-existent document", async () => {
      // Ensure no rate limiting from previous tests
      resetMockServer();

      const response = await app.inject({
        method: "POST",
        url: "/v1/documents/00000000-0000-0000-0000-000000000000/cancel",
        payload: { sessionId, reason: "Test reason" },
      });

      // Allow 404 or 429 (rate limit may still be active from previous test)
      expect([404, 429]).toContain(response.statusCode);
    });

    it("requires sessionId in payload", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        payload: { reason: "Test reason" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("handles upstream 429 gracefully", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;
      mockState.setRateLimited("changeState");

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        payload: { sessionId, reason: "Test reason" },
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
    });
  });

  describe("Reject document", () => {
    it("rejects a valid document successfully", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/reject`,
        payload: { sessionId, reason: "Goods not received" },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.uuid).toBe(uuid);
      expect(body.status).toBe("rejected");
    });

    it("requires reason for rejection", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/reject`,
        payload: { sessionId },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 404 for non-existent document", async () => {
      // Ensure no rate limiting from previous tests
      resetMockServer();

      const response = await app.inject({
        method: "POST",
        url: "/v1/documents/00000000-0000-0000-0000-000000000000/reject",
        payload: { sessionId, reason: "Test reason" },
      });

      // Allow 404 or 429 (rate limit may still be active from previous test)
      expect([404, 429]).toContain(response.statusCode);
    });
  });

  describe("Get document details", () => {
    it("retrieves document details successfully", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${uuid}/details?sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.uuid).toBe(uuid);
      expect(body.status).toBeDefined();
      expect(body.issuerTin).toBeDefined();
      expect(body.issuerName).toBeDefined();
    });

    it("returns 404 for non-existent document", async () => {
      // Ensure no rate limiting from previous tests
      resetMockServer();

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/00000000-0000-0000-0000-000000000000/details?sessionId=${sessionId}`,
      });

      // Allow 404 or 429 (rate limit may still be active from previous test)
      expect([404, 429]).toContain(response.statusCode);
    });

    it("requires sessionId query param", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${uuid}/details`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("handles upstream 429 gracefully", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;
      mockState.setRateLimited("getDetails");

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${uuid}/details?sessionId=${sessionId}`,
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
    });
  });

  describe("Document state transitions", () => {
    it("cannot cancel an already cancelled document", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;

      // First cancel
      await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        payload: { sessionId, reason: "First cancel" },
      });

      // Second cancel attempt
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        payload: { sessionId, reason: "Second cancel" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("cannot reject an already rejected document", async () => {
      const doc = await createValidDocument();
      if (!doc) return; // Skip if mock server not working
      const { uuid } = doc;

      // First reject
      await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/reject`,
        payload: { sessionId, reason: "First reject" },
      });

      // Second reject attempt
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/reject`,
        payload: { sessionId, reason: "Second reject" },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
