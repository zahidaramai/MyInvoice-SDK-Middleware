import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { resetInstances } from "../../lib/myinvois.js";
import { disconnectPrisma, resetPrismaClient } from "@myinvois/storage";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock storage functions when no database available (SKIP_TESTCONTAINERS=true)
// vi.mock is hoisted, so we always mock but the implementations handle the skip logic
vi.mock("@myinvois/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@myinvois/storage")>();

  // If database is available, use original functions
  if (process.env.SKIP_TESTCONTAINERS !== "true") {
    return original;
  }

  // Mock storage for unit tests without database
  // Use a Map to store submissions so getByTrackingId can find them
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
            upstreamSubmissionUid: undefined,
            correlationId: undefined,
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
          // Update documents with results
          const updatedDocs = existing.documents.map((doc) => {
            const accepted = data.acceptedDocuments.find((a) => a.codeNumber === doc.codeNumber);
            const rejected = data.rejectedDocuments.find((r) => r.codeNumber === doc.codeNumber);
            if (accepted) {
              return { ...doc, initialResult: "ACCEPTED", upstreamUuid: accepted.uuid };
            }
            if (rejected) {
              return {
                ...doc,
                initialResult: "REJECTED",
                errorCode: rejected.errorCode,
                errorMessage: rejected.errorMessage,
              };
            }
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
vi.mock("../../lib/pollQueue.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/pollQueue.js")>();

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

describe("POST /v1/submissions", () => {
  let app: FastifyInstance;
  let sessionId: string;

  beforeEach(async () => {
    // Reset all mocks and instances
    mockFetch.mockReset();
    resetInstances();
    sessionStore.clear();

    // Create test session
    const session = sessionStore.create({
      env: "SANDBOX",
      mode: "TAXPAYER",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    sessionId = session.sessionId;

    // Mock login response
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/connect/token")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ correlationid: "test-corr-id" }),
          json: async () => ({
            access_token: "test-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        } as Response;
      }
      // Default mock for other requests
      return {
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ message: "Not mocked" }),
      } as Response;
    });

    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sessionStore.clear();
    resetPrismaClient();
    await disconnectPrisma();
  });

  it("returns 400 for missing sessionId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        documents: [
          {
            format: "XML",
            codeNumber: "INV-001",
            rawDocument: "<invoice>test</invoice>",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("INVALID_SESSION_ID");
  });

  it("returns 400 for invalid sessionId format", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId: "invalid-format",
        documents: [
          {
            format: "XML",
            codeNumber: "INV-001",
            rawDocument: "<invoice>test</invoice>",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("INVALID_SESSION_ID");
  });

  it("returns 404 for non-existent session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId: "sess_nonexistent123",
        documents: [
          {
            format: "XML",
            codeNumber: "INV-001",
            rawDocument: "<invoice>test</invoice>",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns 400 for empty documents array", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId,
        documents: [],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("NO_DOCUMENTS");
  });

  it("returns 400 for document without content", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId,
        documents: [
          {
            format: "XML",
            codeNumber: "INV-001",
            // Missing both rawDocument and documentBase64
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("INVALID_DOCUMENT");
  });

  it("returns 400 for too many documents", async () => {
    const documents = Array.from({ length: 101 }, (_, i) => ({
      format: "XML" as const,
      codeNumber: `INV-${i}`,
      rawDocument: "<invoice>test</invoice>",
    }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId,
        documents,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("TOO_MANY_DOCUMENTS");
  });

  it("returns 400 for document exceeding max size", async () => {
    // Create a document > 300KB
    const largeContent = "x".repeat(350 * 1024);

    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId,
        documents: [
          {
            format: "XML",
            codeNumber: "INV-001",
            rawDocument: largeContent,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("DOCUMENT_TOO_LARGE");
  });

  it("returns 202 on successful submission", async () => {
    // Mock successful upstream submission
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/connect/token")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ correlationid: "auth-corr-id" }),
          json: async () => ({
            access_token: "test-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        } as Response;
      }
      if (url.includes("/documentsubmissions/")) {
        return {
          ok: true,
          status: 202,
          headers: new Headers({ correlationid: "submit-corr-id" }),
          json: async () => ({
            submissionUid: "sub_12345678",
            acceptedDocuments: [
              {
                uuid: "doc-uuid-001",
                invoiceCodeNumber: "INV-001",
              },
            ],
            rejectedDocuments: [],
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ message: "Not mocked" }),
      } as Response;
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId,
        documents: [
          {
            format: "XML",
            codeNumber: "INV-001",
            rawDocument: "<invoice>test</invoice>",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.trackingId).toMatch(/^trk_/);
    expect(body.submissionUid).toBe("sub_12345678");
    expect(body.acceptedDocuments).toHaveLength(1);
    expect(body.acceptedDocuments[0].codeNumber).toBe("INV-001");
    expect(body.acceptedDocuments[0].uuid).toBe("doc-uuid-001");
    expect(body.rejectedDocuments).toHaveLength(0);
    expect(response.headers["x-correlation-id"]).toBe("submit-corr-id");
  });

  it("returns 422 for duplicate submission from upstream", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/connect/token")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            access_token: "test-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        } as Response;
      }
      if (url.includes("/documentsubmissions/")) {
        return {
          ok: false,
          status: 422,
          headers: new Headers({
            correlationid: "dup-corr-id",
            "retry-after": "600",
          }),
          json: async () => ({
            code: "DuplicateSubmission",
            message: "Duplicate submission detected",
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ message: "Not mocked" }),
      } as Response;
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId,
        documents: [
          {
            format: "XML",
            codeNumber: "INV-001",
            rawDocument: "<invoice>test</invoice>",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.code).toBe("DUPLICATE_SUBMISSION");
    expect(response.headers["retry-after"]).toBeDefined();
  });

  it("returns 429 for rate limit from upstream", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/connect/token")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            access_token: "test-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        } as Response;
      }
      if (url.includes("/documentsubmissions/")) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({
            correlationid: "rate-corr-id",
            "retry-after": "60",
          }),
          json: async () => ({
            message: "Too many requests",
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ message: "Not mocked" }),
      } as Response;
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId,
        documents: [
          {
            format: "XML",
            codeNumber: "INV-001",
            rawDocument: "<invoice>test</invoice>",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBeDefined();
  });

  it("handles rejected documents in response", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/connect/token")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            access_token: "test-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        } as Response;
      }
      if (url.includes("/documentsubmissions/")) {
        return {
          ok: true,
          status: 202,
          headers: new Headers({ correlationid: "mixed-corr-id" }),
          json: async () => ({
            submissionUid: "sub_mixed",
            acceptedDocuments: [{ uuid: "doc-uuid-001", invoiceCodeNumber: "INV-001" }],
            rejectedDocuments: [
              {
                invoiceCodeNumber: "INV-002",
                error: {
                  code: "INVALID_STRUCTURE",
                  message: "Invalid document structure",
                },
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ message: "Not mocked" }),
      } as Response;
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {
        sessionId,
        documents: [
          {
            format: "XML",
            codeNumber: "INV-001",
            rawDocument: "<invoice>valid</invoice>",
          },
          {
            format: "XML",
            codeNumber: "INV-002",
            rawDocument: "<invoice>invalid</invoice>",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.acceptedDocuments).toHaveLength(1);
    expect(body.rejectedDocuments).toHaveLength(1);
    expect(body.rejectedDocuments[0].codeNumber).toBe("INV-002");
    expect(body.rejectedDocuments[0].error.errorCode).toBe("INVALID_STRUCTURE");
  });
});

describe("GET /v1/submissions/:trackingId", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockFetch.mockReset();
    resetInstances();
    sessionStore.clear();

    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sessionStore.clear();
    resetPrismaClient();
    await disconnectPrisma();
  });

  it("returns 404 for non-existent tracking ID", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/submissions/trk_nonexistent123",
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe("SUBMISSION_NOT_FOUND");
  });
});
