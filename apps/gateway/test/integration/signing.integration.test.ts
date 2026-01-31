/**
 * Signing Integration Tests
 *
 * Tests end-to-end signing functionality (US-034).
 * These tests verify that signing integrates correctly with the gateway.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";

// Mock storage functions when no database available (SKIP_TESTCONTAINERS=true)
vi.mock("@myinvois/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@myinvois/storage")>();

  if (process.env.SKIP_TESTCONTAINERS !== "true") {
    return original;
  }

  interface MockDocument {
    id: string;
    codeNumber: string;
    initialResult: string;
    upstreamUuid?: string;
    errorCode?: string;
    errorMessage?: string;
  }
  interface MockSubmission {
    id: string;
    trackingId: string;
    sessionId: string;
    payloadHash: string;
    status: string;
    upstreamSubmissionUid?: string;
    correlationId?: string;
    documents: MockDocument[];
    createdAt: Date;
    updatedAt: Date;
  }
  const submissionStore = new Map<string, MockSubmission>();
  let submissionCounter = 0;

  return {
    ...original,
    createSubmission: vi
      .fn()
      .mockImplementation(
        async (data: {
          trackingId: string;
          sessionId: string;
          payloadHash: string;
          documents: Array<{ codeNumber: string }>;
        }) => {
          submissionCounter++;
          const submission: MockSubmission = {
            id: `sub_mock_${submissionCounter}`,
            trackingId: data.trackingId || `trk_mock_${submissionCounter}`,
            sessionId: data.sessionId,
            payloadHash: data.payloadHash || "mock-hash",
            status: "PENDING",
            documents: (data.documents || []).map((d, i) => ({
              id: `doc_mock_${submissionCounter}_${i}`,
              codeNumber: d.codeNumber,
              initialResult: "PENDING",
            })),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          submissionStore.set(submission.trackingId, submission);
          return submission;
        }
      ),
    findRecentByPayloadHash: vi.fn().mockResolvedValue(null),
    updateWithUpstreamResult: vi.fn().mockImplementation(
      async (data: {
        trackingId: string;
        upstreamSubmissionUid: string;
        correlationId?: string;
        acceptedDocuments: Array<{ codeNumber: string; uuid: string }>;
        rejectedDocuments: Array<{
          codeNumber: string;
          errorCode?: string;
          errorMessage?: string;
        }>;
      }) => {
        const existing = submissionStore.get(data.trackingId);
        if (existing) {
          const updatedDocs = existing.documents.map((doc) => {
            const accepted = data.acceptedDocuments.find((a) => a.codeNumber === doc.codeNumber);
            const rejected = data.rejectedDocuments.find((r) => r.codeNumber === doc.codeNumber);
            if (accepted) return { ...doc, initialResult: "ACCEPTED", upstreamUuid: accepted.uuid };
            if (rejected)
              return {
                ...doc,
                initialResult: "REJECTED",
                errorCode: rejected.errorCode,
                errorMessage: rejected.errorMessage,
              };
            return doc;
          });
          const updated: MockSubmission = {
            ...existing,
            upstreamSubmissionUid: data.upstreamSubmissionUid,
            correlationId: data.correlationId,
            documents: updatedDocs,
            status: "SUBMITTED",
            updatedAt: new Date(),
          };
          submissionStore.set(data.trackingId, updated);
          return updated;
        }
        return null;
      }
    ),
    markSubmissionError: vi.fn().mockImplementation(async (trackingId: string, error: string) => {
      const existing = submissionStore.get(trackingId);
      if (existing) {
        const updated = {
          ...existing,
          status: "FAILED",
          errorMessage: error,
          updatedAt: new Date(),
        };
        submissionStore.set(trackingId, updated);
        return updated;
      }
      return null;
    }),
    getByTrackingId: vi.fn().mockImplementation(async (trackingId: string) => {
      return submissionStore.get(trackingId) || null;
    }),
    getByTrackingIdWithPolling: vi.fn().mockImplementation(async (trackingId: string) => {
      return submissionStore.get(trackingId) || null;
    }),
    schedulePoll: vi.fn().mockResolvedValue({}),
  };
});

// Mock poll queue to avoid Redis connection when no containers
vi.mock("../../src/lib/pollQueue.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/pollQueue.js")>();

  if (process.env.SKIP_TESTCONTAINERS !== "true") {
    return original;
  }

  return {
    ...original,
    POLL_QUEUE_NAME: "poll-submission",
    MIN_POLL_INTERVAL_MS: 3000,
    enqueuePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
    enqueueImmediatePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
    calculatePollDelay: vi.fn().mockReturnValue(3000),
    closePollQueue: vi.fn().mockResolvedValue(undefined),
    getPollQueueStats: vi
      .fn()
      .mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
  };
});

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
      expect(body.documentVersion).toBe("1.1"); // Default is now v1.1
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
