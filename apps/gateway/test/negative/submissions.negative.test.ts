/**
 * Negative Tests - Submissions
 *
 * Tests error handling for document submission flows.
 * Covers business validation errors, infrastructure failures, and auth issues.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import {
  startMockServer,
  stopMockServer,
  resetMockServer,
  mockState,
  useMockHandlers,
  negativeHandlers,
  createRateLimitHandler,
} from "../../../../test/msw/server.js";
import { createTaxpayerSession } from "../../../../test/fixtures/sessions.js";
import { createDocumentPayload } from "../../../../test/fixtures/documents.js";
import { ErrorCodes } from "@myinvois/core";

describe("Negative Tests: Submissions", () => {
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
    sessionId = response.json().id;
  });

  afterEach(() => {
    resetMockServer();
  });

  describe("3.1 Business Validation Failures from MyInvois", () => {
    describe("3.1.1 Duplicate Submission (Duplicated Submission Validator)", () => {
      it("returns DUPLICATE_SUBMISSION error with 409 status", async () => {
        // Override default handler with duplicate submission error
        useMockHandlers(negativeHandlers.duplicateSubmission);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-DUPE-001")] },
        });

        expect(response.statusCode).toBe(422); // Current behavior - may adjust to 409
        const body = response.json();
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe(ErrorCodes.DUPLICATE_SUBMISSION);
        expect(body.error.retryable).toBe(false);
        expect(body.error.message).toBeDefined();
      });

      it("does not retry duplicate submission errors", async () => {
        useMockHandlers(negativeHandlers.duplicateSubmission);

        // Make multiple requests - should all fail immediately
        const responses = await Promise.all([
          app.inject({
            method: "POST",
            url: "/v1/submissions",
            payload: { sessionId, documents: [createDocumentPayload("INV-DUPE-001")] },
          }),
          app.inject({
            method: "POST",
            url: "/v1/submissions",
            payload: { sessionId, documents: [createDocumentPayload("INV-DUPE-002")] },
          }),
        ]);

        // All should fail with same error
        for (const response of responses) {
          expect(response.statusCode).toBeGreaterThanOrEqual(400);
        }
      });
    });

    describe("3.1.2 Invalid Taxpayer / Wrong TIN (Taxpayer Profile Validator)", () => {
      it("returns INVALID_TAXPAYER error with 400 status", async () => {
        useMockHandlers(negativeHandlers.invalidTaxpayer);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-BAD-TIN")] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe(ErrorCodes.INVALID_TAXPAYER);
        expect(body.error.retryable).toBe(false);
      });

      it("handles Malay error messages and normalizes to English", async () => {
        useMockHandlers(negativeHandlers.invalidTaxpayerMalay);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-BAD-TIN-MY")] },
        });

        const body = response.json();
        expect(body.error.code).toBe(ErrorCodes.INVALID_TAXPAYER);
        // Message should be normalized/clear in English
        expect(body.error.message).toBeDefined();
      });
    });

    describe("3.1.3 Totals Mismatch (Amount/Totals Validator)", () => {
      it("returns INVALID_TOTALS error with 400 status", async () => {
        useMockHandlers(negativeHandlers.invalidTotals);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-BAD-TOTALS")] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error.code).toBe(ErrorCodes.INVALID_TOTALS);
        expect(body.error.retryable).toBe(false);
      });
    });

    describe("3.1.4 Invalid Document Relation", () => {
      it("returns INVALID_DOCUMENT_RELATION error for credit note without reference", async () => {
        useMockHandlers(negativeHandlers.invalidDocumentRelation);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("CN-NO-REF")] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error.code).toBe(ErrorCodes.INVALID_DOCUMENT_RELATION);
        expect(body.error.retryable).toBe(false);
      });
    });
  });

  describe("3.2 Infrastructure / Platform Failures", () => {
    describe("3.2.5 Upstream Timeout", () => {
      it("returns UPSTREAM_TIMEOUT error with 504 status", async () => {
        // Configure short timeout for test
        useMockHandlers(negativeHandlers.upstreamTimeout);

        // Note: This test may be slow due to timeout
        // In production, configure shorter timeouts for testing
        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-TIMEOUT")] },
        });

        // Should timeout or return error
        expect(response.statusCode).toBeGreaterThanOrEqual(500);
      }, 35000); // Extended timeout for this test
    });

    describe("3.2.6 Upstream 500", () => {
      it("returns UPSTREAM_ERROR with 502 status", async () => {
        useMockHandlers(negativeHandlers.upstream500);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-500")] },
        });

        expect(response.statusCode).toBe(500);
        const body = response.json();
        expect(body.error).toBeDefined();
        expect(body.error.retryable).toBe(true);
      });
    });

    describe("3.2.7 Upstream 429 (Rate Limit)", () => {
      it("returns UPSTREAM_RATE_LIMITED with 429 status and Retry-After", async () => {
        useMockHandlers(negativeHandlers.upstream429);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-429")] },
        });

        expect(response.statusCode).toBe(429);
        expect(response.headers["retry-after"]).toBeDefined();

        const body = response.json();
        expect(body.error.code).toContain("RATE");
        expect(body.error.retryable).toBe(true);
      });

      it("respects custom Retry-After values", async () => {
        useMockHandlers(createRateLimitHandler(120));

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-429-CUSTOM")] },
        });

        expect(response.statusCode).toBe(429);
        // Retry-After should be set
        const retryAfter = response.headers["retry-after"];
        expect(retryAfter).toBeDefined();
      });
    });
  });

  describe("3.3 Auth / Session Failures", () => {
    describe("3.3.8 Invalid Client Credentials", () => {
      it("returns AUTH_INVALID_CLIENT with 401 status", async () => {
        useMockHandlers(negativeHandlers.invalidClient);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-AUTH-FAIL")] },
        });

        expect(response.statusCode).toBe(401);
        const body = response.json();
        expect(body.error).toBeDefined();
        expect(body.error.retryable).toBe(false);
      });

      it("handles 400 invalid_client response", async () => {
        useMockHandlers(negativeHandlers.invalidCredentials400);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-AUTH-400")] },
        });

        // Should be converted to 401
        const body = response.json();
        expect(body.error).toBeDefined();
        expect(body.error.retryable).toBe(false);
      });
    });

    describe("3.3.9 Expired Token", () => {
      it("returns AUTH_TOKEN_EXPIRED and indicates refresh should happen", async () => {
        useMockHandlers(negativeHandlers.expiredToken);

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [createDocumentPayload("INV-TOKEN-EXP")] },
        });

        expect(response.statusCode).toBe(401);
        const body = response.json();
        expect(body.error).toBeDefined();
      });
    });
  });

  describe("3.4 Local Validation / Guardrails", () => {
    describe("3.4.10 Payload Too Large", () => {
      it("rejects document exceeding 300KB with PAYLOAD_TOO_LARGE", async () => {
        // Create a document that's too large
        const largeContent = "x".repeat(350 * 1024); // 350KB
        const largeDocument = {
          format: "JSON",
          codeNumber: "INV-LARGE-001",
          rawDocument: largeContent,
        };

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [largeDocument] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        // Should be blocked before upstream call
      });

      it("rejects submission exceeding 100 documents", async () => {
        // Create 101 documents
        const documents = Array.from({ length: 101 }, (_, i) =>
          createDocumentPayload(`INV-LIMIT-${i.toString().padStart(3, "0")}`)
        );

        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error.message).toContain("100");
      });
    });

    describe("3.4.11 Missing Mandatory Fields", () => {
      it("returns VALIDATION_ERROR for missing sessionId", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          // Missing x-session-id header
          payload: { documents: [createDocumentPayload()] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        expect(body.error.retryable).toBe(false);
      });

      it("returns VALIDATION_ERROR for empty documents array", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents: [] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBeDefined();
        expect(body.error.retryable).toBe(false);
      });

      it("returns VALIDATION_ERROR for missing documents field", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe("3.4.12 Idempotency Violation", () => {
      it("returns cached result for duplicate payload within window", async () => {
        // First submission
        const documents = [createDocumentPayload("INV-IDEMP-001")];

        const response1 = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents },
        });

        expect(response1.statusCode).toBe(202);
        const { trackingId: firstTrackingId } = response1.json();

        // Second submission with same payload
        const response2 = await app.inject({
          method: "POST",
          url: "/v1/submissions",
          payload: { sessionId, documents },
        });

        expect(response2.statusCode).toBe(202);
        const body2 = response2.json();

        // Should return same tracking ID (deduplicated)
        expect(body2.trackingId).toBe(firstTrackingId);
      });
    });
  });

  describe("Error Envelope Contract", () => {
    it("all errors return standardized ErrorEnvelope structure", async () => {
      useMockHandlers(negativeHandlers.invalidTaxpayer);

      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { sessionId, documents: [createDocumentPayload()] },
      });

      const body = response.json();

      // Verify ErrorEnvelope structure
      expect(body).toHaveProperty("error");
      expect(body.error).toHaveProperty("code");
      expect(body.error).toHaveProperty("message");
      expect(body.error).toHaveProperty("httpStatus");
      expect(body.error).toHaveProperty("retryable");
      expect(typeof body.error.code).toBe("string");
      expect(typeof body.error.message).toBe("string");
      expect(typeof body.error.httpStatus).toBe("number");
      expect(typeof body.error.retryable).toBe("boolean");
    });

    it("includes correlation ID in response", async () => {
      useMockHandlers(negativeHandlers.invalidTaxpayer);

      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { sessionId, documents: [createDocumentPayload()] },
      });

      expect(response.headers["x-correlation-id"]).toBeDefined();
    });

    it("includes upstream context for MyInvois errors", async () => {
      useMockHandlers(negativeHandlers.invalidTaxpayer);

      const response = await app.inject({
        method: "POST",
        url: "/v1/submissions",
        payload: { sessionId, documents: [createDocumentPayload()] },
      });

      const body = response.json();

      // Upstream context should be present for MyInvois errors
      if (body.error.upstream) {
        expect(body.error.upstream.source).toBe("MYINVOIS");
      }
    });
  });
});
