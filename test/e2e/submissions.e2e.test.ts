/**
 * E2E Tests - Submissions
 *
 * Tests document submission and deduplication flows.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { buildApp } from "../../apps/gateway/src/app.js";
import type { FastifyInstance } from "fastify";
import { startMockServer, stopMockServer, resetMockServer, mockState } from "../msw/server.js";
import { createTaxpayerSession } from "../fixtures/sessions.js";
import { createDocumentPayload, createDocumentPayloads } from "../fixtures/documents.js";

describe("E2E: Submissions", () => {
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

    // Create a fresh session for each test
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

  describe("Submit documents", () => {
    it("submits a single document successfully (202)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: { documents: [createDocumentPayload("INV-001")] },
      });

      expect(response.statusCode).toBe(202);

      const body = response.json();
      expect(body.trackingId).toMatch(/^trk_/);
      expect(body.status).toBe("SUBMITTED");
      expect(body.submissionUid).toBeDefined();
      expect(body.acceptedDocuments).toHaveLength(1);
      expect(body.acceptedDocuments[0].codeNumber).toBe("INV-001");
      expect(body.rejectedDocuments).toHaveLength(0);
    });

    it("submits multiple documents successfully", async () => {
      const documents = createDocumentPayloads(5, "BATCH");

      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: { documents },
      });

      expect(response.statusCode).toBe(202);

      const body = response.json();
      expect(body.acceptedDocuments).toHaveLength(5);
    });

    it("requires x-session-id header", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { documents: [createDocumentPayload()] },
      });

      expect(response.statusCode).toBe(400);
    });

    it("requires valid session", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": "sess_invalid123" },
        payload: { documents: [createDocumentPayload()] },
      });

      expect(response.statusCode).toBe(404);
    });

    it("requires documents array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects empty documents array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: { documents: [] },
      });

      expect(response.statusCode).toBe(400);
    });

    it("enforces max 100 documents limit", async () => {
      const documents = createDocumentPayloads(101, "LIMIT");

      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: { documents },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().messageEN).toContain("100");
    });

    it("returns correlation ID in response", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: { documents: [createDocumentPayload()] },
      });

      expect(response.headers["x-correlation-id"]).toBeDefined();
    });
  });

  describe("Deduplication (10-minute window)", () => {
    it("returns cached result for duplicate submission", async () => {
      const payload = { documents: [createDocumentPayload("INV-DUPE-001")] };

      // First submission
      const response1 = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload,
      });

      expect(response1.statusCode).toBe(202);
      const { trackingId: firstTrackingId, submissionUid: firstSubmissionUid } = response1.json();

      // Second submission with same payload
      const response2 = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload,
      });

      expect(response2.statusCode).toBe(202);
      const body2 = response2.json();

      // Should return same tracking ID (cached)
      expect(body2.trackingId).toBe(firstTrackingId);
      expect(body2.submissionUid).toBe(firstSubmissionUid);
      expect(body2.status).toBe("DUPLICATE_SUPPRESSED");
    });

    it("creates new submission for different documents", async () => {
      // First submission
      const response1 = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: { documents: [createDocumentPayload("INV-A-001")] },
      });

      expect(response1.statusCode).toBe(202);
      const { trackingId: firstTrackingId } = response1.json();

      // Different document
      const response2 = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: { documents: [createDocumentPayload("INV-B-001")] },
      });

      expect(response2.statusCode).toBe(202);
      const { trackingId: secondTrackingId } = response2.json();

      // Should be different tracking IDs
      expect(secondTrackingId).not.toBe(firstTrackingId);
    });
  });

  describe("Get submission status", () => {
    it("retrieves submission status", async () => {
      // Create submission
      const submitResponse = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: { documents: [createDocumentPayload("INV-STATUS-001")] },
      });
      const { trackingId } = submitResponse.json();

      // Get status
      const response = await app.inject({
        method: "GET",
        url: `/v1/submissions/${trackingId}`,
        headers: { "x-session-id": sessionId },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.trackingId).toBe(trackingId);
      expect(body.status).toBeDefined();
      expect(body.documents).toBeDefined();
    });

    it("returns 404 for non-existent tracking ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/submissions/trk_nonexistent123",
        headers: { "x-session-id": sessionId },
      });

      expect(response.statusCode).toBe(404);
    });

    it("requires x-session-id header", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/submissions/trk_test123",
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for invalid tracking ID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/submissions/invalid-format",
        headers: { "x-session-id": sessionId },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Rate limiting (429)", () => {
    it("handles upstream 429 gracefully", async () => {
      // Set mock to return 429
      mockState.setRateLimited("submit");

      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: { "x-session-id": sessionId },
        payload: { documents: [createDocumentPayload()] },
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
    });
  });
});
