/**
 * Negative Tests - Signing (v1.1)
 *
 * Tests error handling for v1.1 document signing flows.
 * Covers:
 * - Signing disabled/not configured
 * - Upstream signature rejection errors
 * - Certificate validation errors
 * - Document version mismatch scenarios
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
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
import { createDocumentPayload } from "../../../../test/fixtures/documents.js";
import { resetInstances } from "../../src/lib/myinvois.js";
import { sessionStore } from "../../src/lib/sessionStore.js";

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
    createSubmission: vi.fn().mockImplementation(async (data: { trackingId: string; sessionId: string; payloadHash: string; documents: Array<{ codeNumber: string }> }) => {
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
    }),
    findRecentByPayloadHash: vi.fn().mockResolvedValue(null),
    updateWithUpstreamResult: vi.fn().mockImplementation(async (data: {
      trackingId: string;
      upstreamSubmissionUid: string;
      correlationId?: string;
      acceptedDocuments: Array<{ codeNumber: string; uuid: string }>;
      rejectedDocuments: Array<{ codeNumber: string; errorCode?: string; errorMessage?: string }>;
    }) => {
      const existing = submissionStore.get(data.trackingId);
      if (existing) {
        const updatedDocs = existing.documents.map((doc) => {
          const accepted = data.acceptedDocuments.find((a) => a.codeNumber === doc.codeNumber);
          const rejected = data.rejectedDocuments.find((r) => r.codeNumber === doc.codeNumber);
          if (accepted) return { ...doc, initialResult: "ACCEPTED", upstreamUuid: accepted.uuid };
          if (rejected) return { ...doc, initialResult: "REJECTED", errorCode: rejected.errorCode, errorMessage: rejected.errorMessage };
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
    }),
    markSubmissionError: vi.fn().mockImplementation(async (trackingId: string, error: string) => {
      const existing = submissionStore.get(trackingId);
      if (existing) {
        const updated = { ...existing, status: "FAILED", errorMessage: error, updatedAt: new Date() };
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
    getPollQueueStats: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
  };
});

describe("Negative Tests: Signing (v1.1)", () => {
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
    resetInstances();
    sessionStore.clear();

    // Create a fresh session for each test
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

  describe("4.1 Document Version Validation", () => {
    describe("4.1.1 Invalid Document Version", () => {
      it("rejects invalid document version '2.0' with 400 status", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/v1/sessions",
          payload: {
            ...createTaxpayerSession(),
            documentVersion: "2.0",
          },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        expect(body.error.messageEN).toContain("documentVersion");
      });

      it("rejects invalid document version '0.9' with 400 status", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/v1/sessions",
          payload: {
            ...createTaxpayerSession(),
            documentVersion: "0.9",
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it("accepts valid document version '1.0'", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/v1/sessions",
          payload: {
            ...createTaxpayerSession(),
            documentVersion: "1.0",
          },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.documentVersion).toBe("1.0");
      });

      it("handles document version '1.1' based on signing configuration", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/v1/sessions",
          payload: {
            ...createTaxpayerSession(),
            documentVersion: "1.1",
          },
        });

        // v1.1 requires signing to be configured
        // If signing enabled: 201 success
        // If signing disabled: 503 service unavailable
        expect([201, 503]).toContain(response.statusCode);

        if (response.statusCode === 201) {
          const body = response.json();
          expect(body.documentVersion).toBe("1.1");
        } else {
          const body = response.json();
          expect(body.error).toBeDefined();
          expect(body.error.messageEN.toLowerCase()).toMatch(/signing|configured/);
        }
      });
    });
  });

  describe("4.2 Upstream Signature Rejection Errors (MyInvois)", () => {
    describe("4.2.1 Signature Required Error", () => {
      it("returns signature required error when v1.1 document is unsigned", async () => {
        useMockHandlers(negativeHandlers.signingRequired);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-NOSIG-001")] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        // Error code from upstream (may be normalized or raw)
        expect(body.error.code).toMatch(/Signature|SIGNING/i);
        expect(body.error.retryable).toBe(false);
        expect(body.error.messageEN.toLowerCase()).toContain("signature");
      });
    });

    describe("4.2.2 Digest Mismatch Error", () => {
      it("returns digest mismatch error when document hash differs from signed hash", async () => {
        useMockHandlers(negativeHandlers.digestMismatch);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-TAMPERED-001")] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        // Error code from upstream (may be normalized or raw)
        expect(body.error.code).toMatch(/Digest|DIGEST/i);
        expect(body.error.retryable).toBe(false);
        expect(body.error.messageEN.toLowerCase()).toContain("digest");
      });
    });

    describe("4.2.3 Signature Invalid Error", () => {
      it("returns signature invalid error when cryptographic verification fails", async () => {
        useMockHandlers(negativeHandlers.signatureInvalid);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-BADSIG-001")] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        // Error code from upstream (may be normalized or raw)
        expect(body.error.code).toMatch(/Signature|SIGNATURE/i);
        expect(body.error.retryable).toBe(false);
        expect(body.error.messageEN.toLowerCase()).toContain("signature");
      });
    });

    describe("4.2.4 Certificate Rejected Error", () => {
      it("returns certificate rejected error when certificate is not trusted by LHDN", async () => {
        useMockHandlers(negativeHandlers.certificateRejected);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-BADCERT-001")] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        // Error code from upstream (may be normalized or raw)
        expect(body.error.code).toMatch(/Certificate|CERTIFICATE/i);
        expect(body.error.retryable).toBe(false);
        expect(body.error.messageEN.toLowerCase()).toContain("certificate");
      });
    });

    describe("4.2.5 Certificate Expired Upstream Error", () => {
      it("returns certificate error when upstream rejects expired certificate", async () => {
        useMockHandlers(negativeHandlers.certificateExpiredUpstream);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-EXPCERT-001")] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        // Message should contain certificate/expired reference
        expect(body.error.messageEN.toLowerCase()).toMatch(/certificate|expired/i);
        expect(body.error.retryable).toBe(false);
      });
    });

    describe("4.2.6 TIN Mismatch Error", () => {
      it("returns error when authenticated TIN does not match document TIN", async () => {
        useMockHandlers(negativeHandlers.tinMismatch);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-TIN-MISMATCH")] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        expect(body.error.messageEN).toContain("TIN");
        expect(body.error.retryable).toBe(false);
      });
    });
  });

  describe("4.3 Signing Health Status", () => {
    it("includes signing status in readiness check", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/readyz",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body).toHaveProperty("signing");
      expect(body.signing).toHaveProperty("enabled");
      expect(body.signing).toHaveProperty("defaultVersion");
      expect(typeof body.signing.enabled).toBe("boolean");
    });

    it("signing status includes certificate information when enabled", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/readyz",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      if (body.signing.enabled) {
        expect(body.signing).toHaveProperty("certificateValid");
        expect(body.signing).toHaveProperty("certificateExpiry");
      }
    });
  });

  describe("4.4 Error Envelope Structure for Signing Errors", () => {
    it("signing errors include proper ErrorEnvelope structure", async () => {
      useMockHandlers(negativeHandlers.signatureInvalid);

      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { sessionId, documents: [createDocumentPayload("INV-STRUCT-001")] },
      });

      const body = response.json();

      // Verify ErrorEnvelope structure
      expect(body).toHaveProperty("error");
      expect(body.error).toHaveProperty("code");
      expect(body.error).toHaveProperty("messageEN");
      expect(body.error).toHaveProperty("httpStatus");
      expect(body.error).toHaveProperty("retryable");
      expect(typeof body.error.code).toBe("string");
      expect(typeof body.error.messageEN).toBe("string");
      expect(typeof body.error.httpStatus).toBe("number");
      expect(typeof body.error.retryable).toBe("boolean");
    });

    it("signing errors include correlation ID", async () => {
      useMockHandlers(negativeHandlers.digestMismatch);

      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { sessionId, documents: [createDocumentPayload("INV-CORR-001")] },
      });

      expect(response.headers["x-correlation-id"]).toBeDefined();
    });

    it("signature errors include upstream context", async () => {
      useMockHandlers(negativeHandlers.certificateRejected);

      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { sessionId, documents: [createDocumentPayload("INV-UPSTREAM-001")] },
      });

      const body = response.json();

      // Upstream context should be present for MyInvois signature errors
      if (body.error.upstream) {
        expect(body.error.upstream.source).toBe("MYINVOIS");
      }
    });
  });

  describe("4.5 v1.0 Submission Compatibility", () => {
    it("v1.0 submissions do not require signing", async () => {
      // Create v1.0 session explicitly
      const sessionResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          ...createTaxpayerSession(),
          documentVersion: "1.0",
        },
      });

      expect(sessionResponse.statusCode).toBe(201);
      const session = sessionResponse.json();
      expect(session.documentVersion).toBe("1.0");

      // Submit document - should not fail for missing signature
      const submissionResponse = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: {
          sessionId: session.id,
          documents: [createDocumentPayload("INV-V10-001")],
        },
      });

      // Should succeed or fail with non-signing error
      // (202 success, or upstream error like 400 validation, 502 upstream)
      expect([202, 400, 502]).toContain(submissionResponse.statusCode);

      if (submissionResponse.statusCode >= 400) {
        const body = submissionResponse.json();
        // Should NOT be a signing-related error for v1.0
        expect(body.error?.code).not.toBe(ErrorCodes.SIGNING_REQUIRED);
        expect(body.error?.code).not.toBe(ErrorCodes.SIGNING_DISABLED);
      }
    });
  });

  describe("4.6 Session Document Version Persistence", () => {
    it("session remembers document version after creation (v1.0)", async () => {
      // Create session with v1.0 (always allowed)
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          ...createTaxpayerSession(),
          documentVersion: "1.0",
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const created = createResponse.json();
      expect(created.documentVersion).toBe("1.0");

      // Retrieve session
      const getResponse = await app.inject({
        method: "GET",
        url: `/v1/sessions/${created.id}`,
      });

      expect(getResponse.statusCode).toBe(200);
      const retrieved = getResponse.json();
      expect(retrieved.documentVersion).toBe("1.0");
    });

    it("v1.1 session creation depends on signing configuration", async () => {
      // Create session with v1.1
      const createResponse = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: {
          ...createTaxpayerSession(),
          documentVersion: "1.1",
        },
      });

      // If signing is enabled, should succeed with 201
      // If signing is disabled, should fail with 503 (service unavailable)
      expect([201, 503]).toContain(createResponse.statusCode);

      if (createResponse.statusCode === 201) {
        const created = createResponse.json();
        expect(created.documentVersion).toBe("1.1");
      } else {
        const body = createResponse.json();
        expect(body.error).toBeDefined();
        // Should indicate signing not configured
        expect(body.error.code).toMatch(/SIGNING/i);
      }
    });

    it("session defaults to v1.1 when not specified", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: createTaxpayerSession(), // No documentVersion
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.documentVersion).toBe("1.1"); // Default is now v1.1
    });
  });
});
