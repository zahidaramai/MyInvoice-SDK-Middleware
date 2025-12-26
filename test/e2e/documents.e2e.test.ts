/**
 * E2E Tests - Documents
 *
 * Tests document cancel, reject, and details flows.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { buildApp } from "../../apps/gateway/src/app.js";
import type { FastifyInstance } from "fastify";
import { startMockServer, stopMockServer, resetMockServer, mockState } from "../msw/server.js";
import { createTaxpayerSession } from "../fixtures/sessions.js";
import { createDocumentPayload } from "../fixtures/documents.js";

describe("E2E: Documents", () => {
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
    sessionId = response.json().sessionId;
  });

  afterEach(() => {
    resetMockServer();
  });

  /**
   * Helper to create a valid document for testing
   */
  async function createValidDocument(): Promise<{ uuid: string; trackingId: string }> {
    // Submit a document
    const submitResponse = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "x-session-id": sessionId },
      payload: { documents: [createDocumentPayload(`INV-${Date.now()}`)] },
    });

    const { trackingId, submissionUid, acceptedDocuments } = submitResponse.json();
    const uuid = acceptedDocuments[0].uuid;

    // Simulate the document becoming valid (upstream polling complete)
    mockState.setSubmissionStatus(submissionUid, "valid");

    return { uuid, trackingId };
  }

  describe("Cancel document", () => {
    it("cancels a valid document successfully", async () => {
      const { uuid } = await createValidDocument();

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        headers: { "x-session-id": sessionId },
        payload: { reason: "Invoice issued in error" },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.uuid).toBe(uuid);
      expect(body.status).toBe("cancelled");
    });

    it("requires reason for cancellation", async () => {
      const { uuid } = await createValidDocument();

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        headers: { "x-session-id": sessionId },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 404 for non-existent document", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/documents/00000000-0000-0000-0000-000000000000/cancel",
        headers: { "x-session-id": sessionId },
        payload: { reason: "Test reason" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("requires x-session-id header", async () => {
      const { uuid } = await createValidDocument();

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        payload: { reason: "Test reason" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("handles upstream 429 gracefully", async () => {
      const { uuid } = await createValidDocument();
      mockState.setRateLimited("changeState");

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        headers: { "x-session-id": sessionId },
        payload: { reason: "Test reason" },
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
    });
  });

  describe("Reject document", () => {
    it("rejects a valid document successfully", async () => {
      const { uuid } = await createValidDocument();

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/reject`,
        headers: { "x-session-id": sessionId },
        payload: { reason: "Goods not received" },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.uuid).toBe(uuid);
      expect(body.status).toBe("rejected");
    });

    it("requires reason for rejection", async () => {
      const { uuid } = await createValidDocument();

      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/reject`,
        headers: { "x-session-id": sessionId },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 404 for non-existent document", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/documents/00000000-0000-0000-0000-000000000000/reject",
        headers: { "x-session-id": sessionId },
        payload: { reason: "Test reason" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("Get document details", () => {
    it("retrieves document details successfully", async () => {
      const { uuid } = await createValidDocument();

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${uuid}/details`,
        headers: { "x-session-id": sessionId },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.uuid).toBe(uuid);
      expect(body.status).toBeDefined();
      expect(body.issuerTin).toBeDefined();
      expect(body.issuerName).toBeDefined();
    });

    it("returns 404 for non-existent document", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/documents/00000000-0000-0000-0000-000000000000/details",
        headers: { "x-session-id": sessionId },
      });

      expect(response.statusCode).toBe(404);
    });

    it("requires x-session-id header", async () => {
      const { uuid } = await createValidDocument();

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${uuid}/details`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("handles upstream 429 gracefully", async () => {
      const { uuid } = await createValidDocument();
      mockState.setRateLimited("getDetails");

      const response = await app.inject({
        method: "GET",
        url: `/v1/documents/${uuid}/details`,
        headers: { "x-session-id": sessionId },
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
    });
  });

  describe("Document state transitions", () => {
    it("cannot cancel an already cancelled document", async () => {
      const { uuid } = await createValidDocument();

      // First cancel
      await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        headers: { "x-session-id": sessionId },
        payload: { reason: "First cancel" },
      });

      // Second cancel attempt
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/cancel`,
        headers: { "x-session-id": sessionId },
        payload: { reason: "Second cancel" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("cannot reject an already rejected document", async () => {
      const { uuid } = await createValidDocument();

      // First reject
      await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/reject`,
        headers: { "x-session-id": sessionId },
        payload: { reason: "First reject" },
      });

      // Second reject attempt
      const response = await app.inject({
        method: "POST",
        url: `/v1/documents/${uuid}/reject`,
        headers: { "x-session-id": sessionId },
        payload: { reason: "Second reject" },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
