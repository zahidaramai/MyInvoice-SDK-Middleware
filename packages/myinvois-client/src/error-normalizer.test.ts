/**
 * Error Normalizer Unit Tests
 *
 * Tests the normalizeMyinvoisError function with canned MyInvois responses.
 * These tests verify that upstream errors are correctly mapped to our
 * unified ErrorEnvelope format.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeMyinvoisError,
  normalizeNetworkError,
  createLocalValidationError,
  ErrorCodes,
} from "./error-normalizer.js";

describe("normalizeMyinvoisError", () => {
  describe("Business Validation Failures", () => {
    it("normalizes duplicate submission error (Duplicated Submission Validator)", () => {
      const input = {
        httpStatus: 422,
        body: {
          message: "Document already submitted",
          code: "DuplicateSubmission",
        },
        stepName: "Step03-Duplicated Submission Validator",
        path: "/api/v1.0/documentsubmissions/",
        method: "POST",
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.DUPLICATE_SUBMISSION);
      expect(result.httpStatus).toBe(409);
      expect(result.retryable).toBe(false);
      expect(result.message).toContain("already been submitted");
      expect(result.upstream).toEqual({
        source: "MYINVOIS",
        status: 422,
        errorCode: "DuplicateSubmission",
        errorName: "Step03-Duplicated Submission Validator",
        path: "/api/v1.0/documentsubmissions/",
        method: "POST",
      });
    });

    it("normalizes duplicate submission error from message pattern", () => {
      const input = {
        httpStatus: 400,
        body: {
          message: "Duplicated submission detected for this document",
        },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.DUPLICATE_SUBMISSION);
      expect(result.httpStatus).toBe(409);
      expect(result.retryable).toBe(false);
    });

    it("normalizes invalid taxpayer / wrong TIN error (Taxpayer Profile Validator)", () => {
      const input = {
        httpStatus: 400,
        body: {
          message: "No Taxpayer found for the given buyer TIN",
          code: "ERR045",
          propertyPath: "Customer.TIN",
        },
        stepName: "Step05-Taxpayer Profile Validator",
        errorCode: "ERR045",
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.INVALID_TAXPAYER);
      expect(result.httpStatus).toBe(400);
      expect(result.retryable).toBe(false);
      expect(result.message).toContain("verify the TIN");
      expect(result.field).toBe("Customer.TIN");
      expect(result.upstream?.errorCode).toBe("ERR045");
    });

    it("normalizes taxpayer error with Malay message", () => {
      const input = {
        httpStatus: 400,
        body: {
          message: "Tiada pembayar cukai dijumpai untuk TIN pembeli yang diberikan",
          code: "ERR045",
        },
        stepName: "Taxpayer Profile Validator",
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.INVALID_TAXPAYER);
      expect(result.httpStatus).toBe(400);
      expect(result.retryable).toBe(false);
      // Our message should be in English regardless of upstream message
      expect(result.message).toContain("verify the TIN");
    });

    it("normalizes totals mismatch error (Amount/Totals Validator)", () => {
      const input = {
        httpStatus: 400,
        body: {
          message: "Invoice total does not match sum of line items",
          code: "ERR102",
        },
        stepName: "Step08-Amount/Totals Validator",
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.INVALID_TOTALS);
      expect(result.httpStatus).toBe(400);
      expect(result.retryable).toBe(false);
      expect(result.message).toContain("totals do not match");
    });

    it("normalizes document relation error (credit note without reference)", () => {
      const input = {
        httpStatus: 400,
        body: {
          message: "Credit note must reference a valid invoice",
          code: "ERR200",
        },
        stepName: "Document Relation Validator",
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.INVALID_DOCUMENT_RELATION);
      expect(result.httpStatus).toBe(400);
      expect(result.retryable).toBe(false);
      expect(result.message).toContain("reference");
    });

    it("normalizes document structure error", () => {
      const input = {
        httpStatus: 400,
        body: {
          message: "Invalid document structure",
          code: "ERR050",
        },
        stepName: "Document Structure Validator",
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.INVALID_DOCUMENT_STRUCTURE);
      expect(result.httpStatus).toBe(400);
      expect(result.retryable).toBe(false);
    });
  });

  describe("Infrastructure / Platform Failures", () => {
    it("normalizes timeout error (status 0)", () => {
      const input = {
        httpStatus: 0,
        body: undefined,
        path: "/api/v1.0/documentsubmissions/",
        method: "POST",
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.UPSTREAM_TIMEOUT);
      expect(result.httpStatus).toBe(504);
      expect(result.retryable).toBe(true);
      expect(result.message).toContain("timed out");
    });

    it("normalizes timeout error (status 408)", () => {
      const input = {
        httpStatus: 408,
        body: { message: "Request timeout" },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.UPSTREAM_TIMEOUT);
      expect(result.httpStatus).toBe(504);
      expect(result.retryable).toBe(true);
    });

    it("normalizes upstream 500 error", () => {
      const input = {
        httpStatus: 500,
        body: {
          message: "Internal server error",
        },
        path: "/api/v1.0/documentsubmissions/",
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.UPSTREAM_ERROR);
      expect(result.httpStatus).toBe(502);
      expect(result.retryable).toBe(true);
    });

    it("normalizes upstream 502 error", () => {
      const input = {
        httpStatus: 502,
        body: { message: "Bad gateway" },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.UPSTREAM_ERROR);
      expect(result.httpStatus).toBe(502);
      expect(result.retryable).toBe(true);
    });

    it("normalizes upstream 503 error", () => {
      const input = {
        httpStatus: 503,
        body: { message: "Service unavailable" },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.UPSTREAM_ERROR);
      expect(result.httpStatus).toBe(502);
      expect(result.retryable).toBe(true);
    });

    it("normalizes rate limit error (429)", () => {
      const input = {
        httpStatus: 429,
        body: {
          message: "Rate limit exceeded",
          retryAfterSeconds: 60,
        },
        path: "/api/v1.0/documentsubmissions/",
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.UPSTREAM_RATE_LIMITED);
      expect(result.httpStatus).toBe(429);
      expect(result.retryable).toBe(true);
      expect(result.retryAfterSeconds).toBe(60);
    });

    it("normalizes rate limit error with Retry-After header value", () => {
      const input = {
        httpStatus: 429,
        body: {
          message: "Too many requests",
          retryAfter: 120,
        },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.UPSTREAM_RATE_LIMITED);
      expect(result.retryable).toBe(true);
      expect(result.retryAfterSeconds).toBe(120);
    });
  });

  describe("Auth / Session Failures", () => {
    it("normalizes invalid client credentials error", () => {
      const input = {
        httpStatus: 401,
        body: {
          error: "invalid_client",
          error_description: "Invalid client credentials",
        },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.AUTH_INVALID_CLIENT);
      expect(result.httpStatus).toBe(401);
      expect(result.retryable).toBe(false);
      expect(result.message).toContain("client credentials");
    });

    it("normalizes invalid_client from 400 response", () => {
      const input = {
        httpStatus: 400,
        body: {
          error: "invalid_client",
          error_description: "Client authentication failed",
        },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.AUTH_INVALID_CLIENT);
      expect(result.httpStatus).toBe(401);
      expect(result.retryable).toBe(false);
    });

    it("normalizes expired token error", () => {
      const input = {
        httpStatus: 401,
        body: {
          error: "invalid_token",
          error_description: "Token has expired",
        },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.AUTH_TOKEN_EXPIRED);
      expect(result.httpStatus).toBe(401);
      expect(result.retryable).toBe(true);
    });

    it("normalizes generic 401 error", () => {
      const input = {
        httpStatus: 401,
        body: {
          message: "Unauthorized access",
        },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.AUTH_UNAVAILABLE);
      expect(result.httpStatus).toBe(401);
      expect(result.retryable).toBe(true);
    });
  });

  describe("HTTP Status Code Handling", () => {
    it("normalizes 404 not found error", () => {
      const input = {
        httpStatus: 404,
        body: {
          message: "Submission not found",
          code: "NotFound",
        },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.httpStatus).toBe(404);
      expect(result.retryable).toBe(false);
      expect(result.message).toBe("Submission not found");
    });

    it("normalizes 403 forbidden error", () => {
      const input = {
        httpStatus: 403,
        body: {
          message: "Access denied",
        },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.FORBIDDEN);
      expect(result.httpStatus).toBe(403);
      expect(result.retryable).toBe(false);
    });

    it("normalizes generic 400 error", () => {
      const input = {
        httpStatus: 400,
        body: {
          message: "Invalid request format",
        },
      };

      const result = normalizeMyinvoisError(input);

      expect(result.code).toBe(ErrorCodes.DOCUMENT_VALIDATION_FAILED);
      expect(result.httpStatus).toBe(400);
      expect(result.retryable).toBe(false);
    });
  });

  describe("Message Extraction", () => {
    it("extracts message from various body formats", () => {
      const testCases = [
        { body: { message: "Error from message" }, expected: "Error from message" },
        { body: { Message: "Error from Message" }, expected: "Error from Message" },
        { body: { error: "Error from error" }, expected: "Error from error" },
        { body: { error_description: "Error from error_description" }, expected: "Error from error_description" },
        { body: { ErrorMessage: "Error from ErrorMessage" }, expected: "Error from ErrorMessage" },
      ];

      for (const { body, expected } of testCases) {
        const result = normalizeMyinvoisError({
          httpStatus: 404,
          body,
        });
        expect(result.message).toBe(expected);
      }
    });

    it("uses default message when body is empty", () => {
      const result = normalizeMyinvoisError({
        httpStatus: 500,
        body: undefined,
      });

      expect(result.message).toBe("MyInvois service is temporarily unavailable.");
    });

    it("uses default message when body has no message field", () => {
      const result = normalizeMyinvoisError({
        httpStatus: 404,
        body: { someOtherField: "value" },
      });

      expect(result.message).toBe("The requested resource was not found.");
    });
  });

  describe("Correlation ID", () => {
    it("includes correlation ID in envelope", () => {
      const result = normalizeMyinvoisError({
        httpStatus: 400,
        body: { message: "Error" },
        correlationId: "corr-12345",
      });

      expect(result.correlationId).toBe("corr-12345");
    });
  });

  describe("Field Extraction", () => {
    it("extracts field from propertyPath in body", () => {
      const result = normalizeMyinvoisError({
        httpStatus: 400,
        body: {
          message: "Invalid buyer TIN",
          propertyPath: "documents[0].Customer.TIN",
        },
        stepName: "Taxpayer Profile Validator",
      });

      expect(result.field).toBe("documents[0].Customer.TIN");
    });

    it("extracts field from propertyName in body", () => {
      const result = normalizeMyinvoisError({
        httpStatus: 400,
        body: {
          message: "Invalid buyer TIN",
          propertyName: "Customer.TIN",
        },
        stepName: "Taxpayer Profile Validator",
      });

      expect(result.field).toBe("Customer.TIN");
    });
  });
});

describe("normalizeNetworkError", () => {
  it("normalizes timeout/abort error", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";

    const result = normalizeNetworkError(error, {
      path: "/api/v1.0/documentsubmissions/",
      method: "POST",
      correlationId: "corr-123",
    });

    expect(result.code).toBe(ErrorCodes.UPSTREAM_TIMEOUT);
    expect(result.httpStatus).toBe(504);
    expect(result.retryable).toBe(true);
    expect(result.correlationId).toBe("corr-123");
    expect(result.upstream?.path).toBe("/api/v1.0/documentsubmissions/");
  });

  it("normalizes timeout from message", () => {
    const error = new Error("Request timeout exceeded");

    const result = normalizeNetworkError(error);

    expect(result.code).toBe(ErrorCodes.UPSTREAM_TIMEOUT);
    expect(result.httpStatus).toBe(504);
    expect(result.retryable).toBe(true);
  });

  it("normalizes generic network error", () => {
    const error = new Error("fetch failed: ECONNREFUSED");

    const result = normalizeNetworkError(error);

    expect(result.code).toBe(ErrorCodes.NETWORK_ERROR);
    expect(result.httpStatus).toBe(503);
    expect(result.retryable).toBe(true);
    expect(result.message).toContain("ECONNREFUSED");
  });
});

describe("createLocalValidationError", () => {
  it("creates a local validation error", () => {
    const result = createLocalValidationError(
      ErrorCodes.PAYLOAD_TOO_LARGE,
      "Request payload exceeds maximum allowed size of 5MB",
      {
        httpStatus: 413,
        propertyPath: "documents",
        correlationId: "corr-123",
      }
    );

    expect(result.code).toBe(ErrorCodes.PAYLOAD_TOO_LARGE);
    expect(result.message).toBe("Request payload exceeds maximum allowed size of 5MB");
    expect(result.httpStatus).toBe(413);
    expect(result.retryable).toBe(false);
    expect(result.propertyPath).toBe("documents");
    expect(result.upstream?.source).toBe("MIDDLEWARE");
  });

  it("uses default httpStatus of 400", () => {
    const result = createLocalValidationError(
      ErrorCodes.VALIDATION_ERROR,
      "Invalid field value"
    );

    expect(result.httpStatus).toBe(400);
  });
});

describe("Error Code Mapping Table", () => {
  /**
   * This test documents the mapping from MyInvois errors to internal codes.
   * It serves as documentation for the error normalization behavior.
   */
  it("documents the error mapping table", () => {
    const mappingTable = [
      // MyInvois Step/Error → Middleware Code → Retryable
      { step: "Duplicated Submission Validator", code: ErrorCodes.DUPLICATE_SUBMISSION, retryable: false },
      { step: "Taxpayer Profile Validator", code: ErrorCodes.INVALID_TAXPAYER, retryable: false },
      { step: "Amount/Totals Validator", code: ErrorCodes.INVALID_TOTALS, retryable: false },
      { step: "Document Relation Validator", code: ErrorCodes.INVALID_DOCUMENT_RELATION, retryable: false },
      { step: "Document Structure Validator", code: ErrorCodes.INVALID_DOCUMENT_STRUCTURE, retryable: false },
      { httpStatus: 429, code: ErrorCodes.UPSTREAM_RATE_LIMITED, retryable: true },
      { httpStatus: 500, code: ErrorCodes.UPSTREAM_ERROR, retryable: true },
      { httpStatus: 0, code: ErrorCodes.UPSTREAM_TIMEOUT, retryable: true },
      { error: "invalid_client", code: ErrorCodes.AUTH_INVALID_CLIENT, retryable: false },
      { error: "invalid_grant", code: ErrorCodes.AUTH_INVALID_CREDENTIALS, retryable: false },
    ];

    // Verify the mapping is documented
    expect(mappingTable).toHaveLength(10);

    // Verify non-retryable business errors
    const nonRetryableErrors = mappingTable.filter((m) => !m.retryable);
    expect(nonRetryableErrors).toHaveLength(7);

    // Verify retryable infrastructure errors
    const retryableErrors = mappingTable.filter((m) => m.retryable);
    expect(retryableErrors).toHaveLength(3);
  });
});
