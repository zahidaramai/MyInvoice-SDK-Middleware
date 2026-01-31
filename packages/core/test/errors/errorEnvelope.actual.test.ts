/**
 * Actual tests for errorEnvelope that import and test the real functions
 */

import { describe, it, expect } from "vitest";
import {
  ErrorCodes,
  createErrorEnvelope,
  createErrorEnvelopeResponse,
  isRetryableError,
  getHttpStatusForCode,
  type ErrorEnvelope,
} from "../../src/errors/errorEnvelope.js";

describe("errorEnvelope (actual)", () => {
  describe("ErrorCodes", () => {
    it("exports all business validation error codes", () => {
      expect(ErrorCodes.DUPLICATE_SUBMISSION).toBe("DUPLICATE_SUBMISSION");
      expect(ErrorCodes.INVALID_TAXPAYER).toBe("INVALID_TAXPAYER");
      expect(ErrorCodes.INVALID_TOTALS).toBe("INVALID_TOTALS");
      expect(ErrorCodes.INVALID_DOCUMENT_RELATION).toBe("INVALID_DOCUMENT_RELATION");
      expect(ErrorCodes.INVALID_DOCUMENT_STRUCTURE).toBe("INVALID_DOCUMENT_STRUCTURE");
      expect(ErrorCodes.DOCUMENT_VALIDATION_FAILED).toBe("DOCUMENT_VALIDATION_FAILED");
    });

    it("exports all infrastructure error codes", () => {
      expect(ErrorCodes.UPSTREAM_TIMEOUT).toBe("UPSTREAM_TIMEOUT");
      expect(ErrorCodes.UPSTREAM_ERROR).toBe("UPSTREAM_ERROR");
      expect(ErrorCodes.UPSTREAM_RATE_LIMITED).toBe("UPSTREAM_RATE_LIMITED");
      expect(ErrorCodes.NETWORK_ERROR).toBe("NETWORK_ERROR");
    });

    it("exports all auth error codes", () => {
      expect(ErrorCodes.AUTH_INVALID_CLIENT).toBe("AUTH_INVALID_CLIENT");
      expect(ErrorCodes.AUTH_INVALID_CREDENTIALS).toBe("AUTH_INVALID_CREDENTIALS");
      expect(ErrorCodes.AUTH_TOKEN_EXPIRED).toBe("AUTH_TOKEN_EXPIRED");
      expect(ErrorCodes.AUTH_UNAVAILABLE).toBe("AUTH_UNAVAILABLE");
      expect(ErrorCodes.SESSION_NOT_FOUND).toBe("SESSION_NOT_FOUND");
      expect(ErrorCodes.SESSION_EXPIRED).toBe("SESSION_EXPIRED");
    });

    it("exports all local validation error codes", () => {
      expect(ErrorCodes.PAYLOAD_TOO_LARGE).toBe("PAYLOAD_TOO_LARGE");
      expect(ErrorCodes.DOCUMENT_TOO_LARGE).toBe("DOCUMENT_TOO_LARGE");
      expect(ErrorCodes.TOO_MANY_DOCUMENTS).toBe("TOO_MANY_DOCUMENTS");
      expect(ErrorCodes.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
      expect(ErrorCodes.IDEMPOTENCY_CONFLICT).toBe("IDEMPOTENCY_CONFLICT");
      expect(ErrorCodes.MISSING_REQUIRED_FIELD).toBe("MISSING_REQUIRED_FIELD");
    });

    it("exports all signing error codes (local)", () => {
      expect(ErrorCodes.SIGNING_DISABLED).toBe("SIGNING_DISABLED");
      expect(ErrorCodes.CERTIFICATE_LOAD_FAILED).toBe("CERTIFICATE_LOAD_FAILED");
      expect(ErrorCodes.PRIVATE_KEY_LOAD_FAILED).toBe("PRIVATE_KEY_LOAD_FAILED");
      expect(ErrorCodes.CERTIFICATE_EXPIRED).toBe("CERTIFICATE_EXPIRED");
      expect(ErrorCodes.CERTIFICATE_NOT_YET_VALID).toBe("CERTIFICATE_NOT_YET_VALID");
      expect(ErrorCodes.KEY_CERTIFICATE_MISMATCH).toBe("KEY_CERTIFICATE_MISMATCH");
      expect(ErrorCodes.SIGNING_FAILED).toBe("SIGNING_FAILED");
      expect(ErrorCodes.SIGNATURE_VERIFICATION_FAILED).toBe("SIGNATURE_VERIFICATION_FAILED");
      expect(ErrorCodes.INVALID_DOCUMENT_VERSION).toBe("INVALID_DOCUMENT_VERSION");
      expect(ErrorCodes.SIGNING_NOT_CONFIGURED).toBe("SIGNING_NOT_CONFIGURED");
    });

    it("exports all signing error codes (upstream)", () => {
      expect(ErrorCodes.SIGNING_REQUIRED).toBe("SIGNING_REQUIRED");
      expect(ErrorCodes.DIGEST_MISMATCH).toBe("DIGEST_MISMATCH");
      expect(ErrorCodes.SIGNATURE_INVALID).toBe("SIGNATURE_INVALID");
      expect(ErrorCodes.CERTIFICATE_REJECTED).toBe("CERTIFICATE_REJECTED");
    });

    it("exports all generic error codes", () => {
      expect(ErrorCodes.NOT_FOUND).toBe("NOT_FOUND");
      expect(ErrorCodes.FORBIDDEN).toBe("FORBIDDEN");
      expect(ErrorCodes.BAD_REQUEST).toBe("BAD_REQUEST");
      expect(ErrorCodes.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
    });
  });

  describe("createErrorEnvelope", () => {
    it("creates basic error envelope with required fields", () => {
      const envelope = createErrorEnvelope(
        ErrorCodes.VALIDATION_ERROR,
        "Validation failed",
        400
      );

      expect(envelope.code).toBe("VALIDATION_ERROR");
      expect(envelope.messageEN).toBe("Validation failed");
      expect(envelope.httpStatus).toBe(400);
      expect(envelope.retryable).toBe(false); // default
    });

    it("creates error envelope with custom retryable flag", () => {
      const envelope = createErrorEnvelope(
        ErrorCodes.UPSTREAM_TIMEOUT,
        "Request timed out",
        504,
        { retryable: true }
      );

      expect(envelope.code).toBe("UPSTREAM_TIMEOUT");
      expect(envelope.httpStatus).toBe(504);
      expect(envelope.retryable).toBe(true);
    });

    it("creates error envelope with all optional fields", () => {
      const envelope = createErrorEnvelope(
        ErrorCodes.INVALID_TAXPAYER,
        "TIN not registered",
        400,
        {
          retryable: false,
          upstream: {
            source: "MYINVOIS",
            status: 400,
            errorCode: "ERR045",
            errorName: "Step05-Taxpayer Profile Validator",
            path: "/api/v1.0/documentsubmissions",
            method: "POST",
          },
          field: "Customer.TIN",
          propertyPath: "documents[0].Customer.TIN",
          correlationId: "corr-123",
          trackingId: "track-456",
          retryAfterSeconds: 60,
          details: [
            {
              code: "TIN_NOT_FOUND",
              messageEN: "TIN is not registered with LHDN",
              field: "TIN",
              propertyPath: "documents[0].TIN",
            },
          ],
        }
      );

      expect(envelope.code).toBe("INVALID_TAXPAYER");
      expect(envelope.upstream?.source).toBe("MYINVOIS");
      expect(envelope.upstream?.errorCode).toBe("ERR045");
      expect(envelope.upstream?.errorName).toBe("Step05-Taxpayer Profile Validator");
      expect(envelope.field).toBe("Customer.TIN");
      expect(envelope.propertyPath).toBe("documents[0].Customer.TIN");
      expect(envelope.correlationId).toBe("corr-123");
      expect(envelope.trackingId).toBe("track-456");
      expect(envelope.retryAfterSeconds).toBe(60);
      expect(envelope.details).toHaveLength(1);
      expect(envelope.details?.[0].code).toBe("TIN_NOT_FOUND");
    });

    it("allows custom error codes as strings", () => {
      const envelope = createErrorEnvelope(
        "CUSTOM_ERROR_CODE",
        "Custom error occurred",
        500
      );

      expect(envelope.code).toBe("CUSTOM_ERROR_CODE");
    });

    it("preserves retryable default when options provided without retryable", () => {
      const envelope = createErrorEnvelope(
        ErrorCodes.NOT_FOUND,
        "Document not found",
        404,
        { correlationId: "corr-123" }
      );

      expect(envelope.retryable).toBe(false);
      expect(envelope.correlationId).toBe("corr-123");
    });
  });

  describe("createErrorEnvelopeResponse", () => {
    it("wraps envelope in error property", () => {
      const envelope = createErrorEnvelope(
        ErrorCodes.BAD_REQUEST,
        "Invalid request",
        400
      );

      const response = createErrorEnvelopeResponse(envelope);

      expect(response.error).toBe(envelope);
      expect(response.error.code).toBe("BAD_REQUEST");
    });

    it("creates response with all envelope fields accessible", () => {
      const envelope: ErrorEnvelope = {
        code: ErrorCodes.DUPLICATE_SUBMISSION,
        messageEN: "Duplicate submission detected",
        httpStatus: 409,
        retryable: false,
        trackingId: "track-789",
      };

      const response = createErrorEnvelopeResponse(envelope);

      expect(response.error.code).toBe("DUPLICATE_SUBMISSION");
      expect(response.error.trackingId).toBe("track-789");
      expect(response.error.httpStatus).toBe(409);
    });
  });

  describe("isRetryableError", () => {
    it("returns true for UPSTREAM_TIMEOUT", () => {
      expect(isRetryableError(ErrorCodes.UPSTREAM_TIMEOUT)).toBe(true);
    });

    it("returns true for UPSTREAM_ERROR", () => {
      expect(isRetryableError(ErrorCodes.UPSTREAM_ERROR)).toBe(true);
    });

    it("returns true for UPSTREAM_RATE_LIMITED", () => {
      expect(isRetryableError(ErrorCodes.UPSTREAM_RATE_LIMITED)).toBe(true);
    });

    it("returns true for NETWORK_ERROR", () => {
      expect(isRetryableError(ErrorCodes.NETWORK_ERROR)).toBe(true);
    });

    it("returns true for AUTH_UNAVAILABLE", () => {
      expect(isRetryableError(ErrorCodes.AUTH_UNAVAILABLE)).toBe(true);
    });

    it("returns false for business validation errors", () => {
      expect(isRetryableError(ErrorCodes.DUPLICATE_SUBMISSION)).toBe(false);
      expect(isRetryableError(ErrorCodes.INVALID_TAXPAYER)).toBe(false);
      expect(isRetryableError(ErrorCodes.INVALID_TOTALS)).toBe(false);
      expect(isRetryableError(ErrorCodes.INVALID_DOCUMENT_RELATION)).toBe(false);
      expect(isRetryableError(ErrorCodes.INVALID_DOCUMENT_STRUCTURE)).toBe(false);
      expect(isRetryableError(ErrorCodes.DOCUMENT_VALIDATION_FAILED)).toBe(false);
    });

    it("returns false for auth errors (except AUTH_UNAVAILABLE)", () => {
      expect(isRetryableError(ErrorCodes.AUTH_INVALID_CLIENT)).toBe(false);
      expect(isRetryableError(ErrorCodes.AUTH_INVALID_CREDENTIALS)).toBe(false);
      expect(isRetryableError(ErrorCodes.AUTH_TOKEN_EXPIRED)).toBe(false);
      expect(isRetryableError(ErrorCodes.SESSION_NOT_FOUND)).toBe(false);
      expect(isRetryableError(ErrorCodes.SESSION_EXPIRED)).toBe(false);
    });

    it("returns false for local validation errors", () => {
      expect(isRetryableError(ErrorCodes.PAYLOAD_TOO_LARGE)).toBe(false);
      expect(isRetryableError(ErrorCodes.DOCUMENT_TOO_LARGE)).toBe(false);
      expect(isRetryableError(ErrorCodes.TOO_MANY_DOCUMENTS)).toBe(false);
      expect(isRetryableError(ErrorCodes.VALIDATION_ERROR)).toBe(false);
    });

    it("returns false for signing errors", () => {
      expect(isRetryableError(ErrorCodes.SIGNING_DISABLED)).toBe(false);
      expect(isRetryableError(ErrorCodes.CERTIFICATE_LOAD_FAILED)).toBe(false);
      expect(isRetryableError(ErrorCodes.SIGNING_FAILED)).toBe(false);
    });

    it("returns false for generic errors", () => {
      expect(isRetryableError(ErrorCodes.NOT_FOUND)).toBe(false);
      expect(isRetryableError(ErrorCodes.FORBIDDEN)).toBe(false);
      expect(isRetryableError(ErrorCodes.BAD_REQUEST)).toBe(false);
      expect(isRetryableError(ErrorCodes.INTERNAL_ERROR)).toBe(false);
    });

    it("returns false for unknown codes", () => {
      expect(isRetryableError("UNKNOWN_CODE")).toBe(false);
    });
  });

  describe("getHttpStatusForCode", () => {
    describe("business validation errors", () => {
      it("returns 409 for DUPLICATE_SUBMISSION", () => {
        expect(getHttpStatusForCode(ErrorCodes.DUPLICATE_SUBMISSION)).toBe(409);
      });

      it("returns 400 for INVALID_TAXPAYER", () => {
        expect(getHttpStatusForCode(ErrorCodes.INVALID_TAXPAYER)).toBe(400);
      });

      it("returns 400 for INVALID_TOTALS", () => {
        expect(getHttpStatusForCode(ErrorCodes.INVALID_TOTALS)).toBe(400);
      });

      it("returns 400 for INVALID_DOCUMENT_RELATION", () => {
        expect(getHttpStatusForCode(ErrorCodes.INVALID_DOCUMENT_RELATION)).toBe(400);
      });

      it("returns 400 for INVALID_DOCUMENT_STRUCTURE", () => {
        expect(getHttpStatusForCode(ErrorCodes.INVALID_DOCUMENT_STRUCTURE)).toBe(400);
      });

      it("returns 400 for DOCUMENT_VALIDATION_FAILED", () => {
        expect(getHttpStatusForCode(ErrorCodes.DOCUMENT_VALIDATION_FAILED)).toBe(400);
      });
    });

    describe("infrastructure errors", () => {
      it("returns 504 for UPSTREAM_TIMEOUT", () => {
        expect(getHttpStatusForCode(ErrorCodes.UPSTREAM_TIMEOUT)).toBe(504);
      });

      it("returns 502 for UPSTREAM_ERROR", () => {
        expect(getHttpStatusForCode(ErrorCodes.UPSTREAM_ERROR)).toBe(502);
      });

      it("returns 429 for UPSTREAM_RATE_LIMITED", () => {
        expect(getHttpStatusForCode(ErrorCodes.UPSTREAM_RATE_LIMITED)).toBe(429);
      });

      it("returns 503 for NETWORK_ERROR", () => {
        expect(getHttpStatusForCode(ErrorCodes.NETWORK_ERROR)).toBe(503);
      });
    });

    describe("auth errors", () => {
      it("returns 401 for AUTH_INVALID_CLIENT", () => {
        expect(getHttpStatusForCode(ErrorCodes.AUTH_INVALID_CLIENT)).toBe(401);
      });

      it("returns 401 for AUTH_INVALID_CREDENTIALS", () => {
        expect(getHttpStatusForCode(ErrorCodes.AUTH_INVALID_CREDENTIALS)).toBe(401);
      });

      it("returns 401 for AUTH_TOKEN_EXPIRED", () => {
        expect(getHttpStatusForCode(ErrorCodes.AUTH_TOKEN_EXPIRED)).toBe(401);
      });

      it("returns 503 for AUTH_UNAVAILABLE", () => {
        expect(getHttpStatusForCode(ErrorCodes.AUTH_UNAVAILABLE)).toBe(503);
      });

      it("returns 404 for SESSION_NOT_FOUND", () => {
        expect(getHttpStatusForCode(ErrorCodes.SESSION_NOT_FOUND)).toBe(404);
      });

      it("returns 401 for SESSION_EXPIRED", () => {
        expect(getHttpStatusForCode(ErrorCodes.SESSION_EXPIRED)).toBe(401);
      });
    });

    describe("local validation errors", () => {
      it("returns 413 for PAYLOAD_TOO_LARGE", () => {
        expect(getHttpStatusForCode(ErrorCodes.PAYLOAD_TOO_LARGE)).toBe(413);
      });

      it("returns 413 for DOCUMENT_TOO_LARGE", () => {
        expect(getHttpStatusForCode(ErrorCodes.DOCUMENT_TOO_LARGE)).toBe(413);
      });

      it("returns 400 for TOO_MANY_DOCUMENTS", () => {
        expect(getHttpStatusForCode(ErrorCodes.TOO_MANY_DOCUMENTS)).toBe(400);
      });

      it("returns 400 for VALIDATION_ERROR", () => {
        expect(getHttpStatusForCode(ErrorCodes.VALIDATION_ERROR)).toBe(400);
      });

      it("returns 409 for IDEMPOTENCY_CONFLICT", () => {
        expect(getHttpStatusForCode(ErrorCodes.IDEMPOTENCY_CONFLICT)).toBe(409);
      });

      it("returns 400 for MISSING_REQUIRED_FIELD", () => {
        expect(getHttpStatusForCode(ErrorCodes.MISSING_REQUIRED_FIELD)).toBe(400);
      });
    });

    describe("signing errors (local)", () => {
      it("returns 503 for SIGNING_DISABLED", () => {
        expect(getHttpStatusForCode(ErrorCodes.SIGNING_DISABLED)).toBe(503);
      });

      it("returns 500 for CERTIFICATE_LOAD_FAILED", () => {
        expect(getHttpStatusForCode(ErrorCodes.CERTIFICATE_LOAD_FAILED)).toBe(500);
      });

      it("returns 500 for PRIVATE_KEY_LOAD_FAILED", () => {
        expect(getHttpStatusForCode(ErrorCodes.PRIVATE_KEY_LOAD_FAILED)).toBe(500);
      });

      it("returns 503 for CERTIFICATE_EXPIRED", () => {
        expect(getHttpStatusForCode(ErrorCodes.CERTIFICATE_EXPIRED)).toBe(503);
      });

      it("returns 503 for CERTIFICATE_NOT_YET_VALID", () => {
        expect(getHttpStatusForCode(ErrorCodes.CERTIFICATE_NOT_YET_VALID)).toBe(503);
      });

      it("returns 500 for KEY_CERTIFICATE_MISMATCH", () => {
        expect(getHttpStatusForCode(ErrorCodes.KEY_CERTIFICATE_MISMATCH)).toBe(500);
      });

      it("returns 500 for SIGNING_FAILED", () => {
        expect(getHttpStatusForCode(ErrorCodes.SIGNING_FAILED)).toBe(500);
      });

      it("returns 400 for SIGNATURE_VERIFICATION_FAILED", () => {
        expect(getHttpStatusForCode(ErrorCodes.SIGNATURE_VERIFICATION_FAILED)).toBe(400);
      });

      it("returns 400 for INVALID_DOCUMENT_VERSION", () => {
        expect(getHttpStatusForCode(ErrorCodes.INVALID_DOCUMENT_VERSION)).toBe(400);
      });

      it("returns 503 for SIGNING_NOT_CONFIGURED", () => {
        expect(getHttpStatusForCode(ErrorCodes.SIGNING_NOT_CONFIGURED)).toBe(503);
      });
    });

    describe("signing errors (upstream)", () => {
      it("returns 400 for SIGNING_REQUIRED", () => {
        expect(getHttpStatusForCode(ErrorCodes.SIGNING_REQUIRED)).toBe(400);
      });

      it("returns 400 for DIGEST_MISMATCH", () => {
        expect(getHttpStatusForCode(ErrorCodes.DIGEST_MISMATCH)).toBe(400);
      });

      it("returns 400 for SIGNATURE_INVALID", () => {
        expect(getHttpStatusForCode(ErrorCodes.SIGNATURE_INVALID)).toBe(400);
      });

      it("returns 400 for CERTIFICATE_REJECTED", () => {
        expect(getHttpStatusForCode(ErrorCodes.CERTIFICATE_REJECTED)).toBe(400);
      });
    });

    describe("generic errors", () => {
      it("returns 404 for NOT_FOUND", () => {
        expect(getHttpStatusForCode(ErrorCodes.NOT_FOUND)).toBe(404);
      });

      it("returns 403 for FORBIDDEN", () => {
        expect(getHttpStatusForCode(ErrorCodes.FORBIDDEN)).toBe(403);
      });

      it("returns 400 for BAD_REQUEST", () => {
        expect(getHttpStatusForCode(ErrorCodes.BAD_REQUEST)).toBe(400);
      });

      it("returns 500 for INTERNAL_ERROR", () => {
        expect(getHttpStatusForCode(ErrorCodes.INTERNAL_ERROR)).toBe(500);
      });
    });

    describe("unknown codes", () => {
      it("returns 500 for unknown error code", () => {
        expect(getHttpStatusForCode("UNKNOWN_ERROR_CODE")).toBe(500);
      });

      it("returns 500 for empty string", () => {
        expect(getHttpStatusForCode("")).toBe(500);
      });
    });
  });

  describe("type exports", () => {
    it("ErrorEnvelope can be used as a type", () => {
      const envelope: ErrorEnvelope = {
        code: ErrorCodes.VALIDATION_ERROR,
        messageEN: "Test message",
        httpStatus: 400,
        retryable: false,
      };

      expect(envelope.code).toBe("VALIDATION_ERROR");
    });
  });
});
