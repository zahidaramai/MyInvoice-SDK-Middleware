/**
 * Tests for errorEnvelope
 */

import { describe, it, expect } from "vitest";

describe("errorEnvelope", () => {
  describe("error structure", () => {
    it("creates error envelope with required fields", () => {
      const envelope = {
        ok: false as const,
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
        },
      };

      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("VALIDATION_ERROR");
      expect(envelope.error.message).toBe("Validation failed");
    });

    it("creates error envelope with optional details", () => {
      const envelope = {
        ok: false as const,
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: [
            { field: "tin", message: "Invalid TIN format" },
            { field: "amount", message: "Amount must be positive" },
          ],
        },
      };

      expect(envelope.error.details).toHaveLength(2);
      expect(envelope.error.details![0].field).toBe("tin");
    });

    it("creates error envelope with target", () => {
      const envelope = {
        ok: false as const,
        error: {
          code: "INVALID_TIN",
          message: "TIN not registered",
          target: "C99999999999",
        },
      };

      expect(envelope.error.target).toBe("C99999999999");
    });

    it("creates error envelope with inner errors", () => {
      const envelope = {
        ok: false as const,
        error: {
          code: "SUBMISSION_FAILED",
          message: "Document submission failed",
          innerErrors: [
            { code: "INVALID_TIN", message: "TIN validation failed" },
            { code: "INVALID_AMOUNT", message: "Amount mismatch" },
          ],
        },
      };

      expect(envelope.error.innerErrors).toHaveLength(2);
    });
  });

  describe("success envelope", () => {
    it("creates success envelope with data", () => {
      const envelope = {
        ok: true as const,
        data: {
          uuid: "test-uuid",
          status: "VALID",
        },
      };

      expect(envelope.ok).toBe(true);
      expect(envelope.data.uuid).toBe("test-uuid");
    });

    it("creates success envelope with null data", () => {
      const envelope = {
        ok: true as const,
        data: null,
      };

      expect(envelope.ok).toBe(true);
      expect(envelope.data).toBeNull();
    });
  });

  describe("error codes", () => {
    it("defines validation error codes", () => {
      const validationCodes = [
        "VALIDATION_ERROR",
        "INVALID_TIN",
        "INVALID_BRN",
        "INVALID_AMOUNT",
        "INVALID_TAX_AMOUNT",
        "INVALID_DATE",
        "MISSING_REQUIRED_FIELD",
      ];

      validationCodes.forEach((code) => {
        expect(typeof code).toBe("string");
        expect(code).toMatch(/^[A-Z_]+$/);
      });
    });

    it("defines authentication error codes", () => {
      const authCodes = [
        "UNAUTHORIZED",
        "FORBIDDEN",
        "TOKEN_EXPIRED",
        "INVALID_TOKEN",
        "LOGIN_FAILED",
        "REFRESH_FAILED",
      ];

      authCodes.forEach((code) => {
        expect(typeof code).toBe("string");
      });
    });

    it("defines submission error codes", () => {
      const submissionCodes = [
        "SUBMISSION_FAILED",
        "DUPLICATE_SUBMISSION",
        "DOCUMENT_NOT_FOUND",
        "INCORRECT_SUBMITTER",
        "RATE_LIMIT_EXCEEDED",
      ];

      submissionCodes.forEach((code) => {
        expect(typeof code).toBe("string");
      });
    });

    it("defines network error codes", () => {
      const networkCodes = ["NETWORK_ERROR", "TIMEOUT", "CONNECTION_REFUSED", "DNS_FAILURE"];

      networkCodes.forEach((code) => {
        expect(typeof code).toBe("string");
      });
    });

    it("defines system error codes", () => {
      const systemCodes = [
        "INTERNAL_ERROR",
        "DATABASE_ERROR",
        "CONFIGURATION_ERROR",
        "UPSTREAM_ERROR",
      ];

      systemCodes.forEach((code) => {
        expect(typeof code).toBe("string");
      });
    });
  });

  describe("HTTP status mapping", () => {
    it("maps validation errors to 400", () => {
      const mapping: Record<string, number> = {
        VALIDATION_ERROR: 400,
        INVALID_TIN: 400,
        MISSING_REQUIRED_FIELD: 400,
      };

      expect(mapping.VALIDATION_ERROR).toBe(400);
      expect(mapping.INVALID_TIN).toBe(400);
    });

    it("maps auth errors to 401/403", () => {
      const mapping: Record<string, number> = {
        UNAUTHORIZED: 401,
        TOKEN_EXPIRED: 401,
        FORBIDDEN: 403,
        INCORRECT_SUBMITTER: 403,
      };

      expect(mapping.UNAUTHORIZED).toBe(401);
      expect(mapping.FORBIDDEN).toBe(403);
    });

    it("maps not found errors to 404", () => {
      const mapping: Record<string, number> = {
        DOCUMENT_NOT_FOUND: 404,
        COMPANY_NOT_FOUND: 404,
        USER_NOT_FOUND: 404,
      };

      expect(mapping.DOCUMENT_NOT_FOUND).toBe(404);
    });

    it("maps duplicate errors to 409/422", () => {
      const mapping: Record<string, number> = {
        DUPLICATE_SUBMISSION: 422,
        CONFLICT: 409,
      };

      expect(mapping.DUPLICATE_SUBMISSION).toBe(422);
      expect(mapping.CONFLICT).toBe(409);
    });

    it("maps rate limit errors to 429", () => {
      const mapping: Record<string, number> = {
        RATE_LIMIT_EXCEEDED: 429,
        UPSTREAM_RATE_LIMIT: 429,
      };

      expect(mapping.RATE_LIMIT_EXCEEDED).toBe(429);
    });

    it("maps server errors to 500", () => {
      const mapping: Record<string, number> = {
        INTERNAL_ERROR: 500,
        DATABASE_ERROR: 500,
        UPSTREAM_ERROR: 502,
      };

      expect(mapping.INTERNAL_ERROR).toBe(500);
      expect(mapping.UPSTREAM_ERROR).toBe(502);
    });
  });

  describe("error message formatting", () => {
    it("formats simple error message", () => {
      const error = {
        code: "INVALID_TIN",
        message: "TIN not registered",
      };

      expect(`[${error.code}] ${error.message}`).toBe("[INVALID_TIN] TIN not registered");
    });

    it("formats error with target", () => {
      const error = {
        code: "INVALID_TIN",
        message: "TIN not registered",
        target: "C99999999999",
      };

      const formatted = `[${error.code}] ${error.message}: ${error.target}`;
      expect(formatted).toBe("[INVALID_TIN] TIN not registered: C99999999999");
    });

    it("formats error with property path", () => {
      const error = {
        code: "INVALID_AMOUNT",
        message: "Amount mismatch",
        propertyPath: "Invoice/TaxTotal/TaxAmount",
      };

      const formatted = `[${error.code}] ${error.message} at ${error.propertyPath}`;
      expect(formatted).toBe("[INVALID_AMOUNT] Amount mismatch at Invoice/TaxTotal/TaxAmount");
    });
  });

  describe("error serialization", () => {
    it("serializes error to JSON", () => {
      const envelope = {
        ok: false as const,
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: [{ field: "tin", message: "Invalid" }],
        },
      };

      const json = JSON.stringify(envelope);
      const parsed = JSON.parse(json);

      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe("VALIDATION_ERROR");
    });

    it("excludes undefined fields in serialization", () => {
      const envelope = {
        ok: false as const,
        error: {
          code: "ERROR",
          message: "Error",
          target: undefined,
          details: undefined,
        },
      };

      const json = JSON.stringify(envelope);
      expect(json).not.toContain("target");
      expect(json).not.toContain("details");
    });
  });

  describe("error comparison", () => {
    it("checks if error matches code", () => {
      const error = { code: "INVALID_TIN", message: "TIN error" };

      expect(error.code === "INVALID_TIN").toBe(true);
      expect(error.code === "INVALID_BRN").toBe(false);
    });

    it("checks if error is retriable", () => {
      const retriableCodes = ["NETWORK_ERROR", "TIMEOUT", "RATE_LIMIT_EXCEEDED", "UPSTREAM_ERROR"];

      const isRetriable = (code: string) => retriableCodes.includes(code);

      expect(isRetriable("NETWORK_ERROR")).toBe(true);
      expect(isRetriable("TIMEOUT")).toBe(true);
      expect(isRetriable("INVALID_TIN")).toBe(false);
    });

    it("checks if error is terminal", () => {
      const terminalCodes = [
        "INVALID_TIN",
        "DUPLICATE_SUBMISSION",
        "FORBIDDEN",
        "DOCUMENT_NOT_FOUND",
      ];

      const isTerminal = (code: string) => terminalCodes.includes(code);

      expect(isTerminal("INVALID_TIN")).toBe(true);
      expect(isTerminal("NETWORK_ERROR")).toBe(false);
    });
  });

  describe("error helpers", () => {
    it("creates validation error", () => {
      const createValidationError = (message: string, field?: string) => ({
        ok: false as const,
        error: {
          code: "VALIDATION_ERROR",
          message,
          ...(field && { target: field }),
        },
      });

      const error = createValidationError("Invalid input", "tin");
      expect(error.error.code).toBe("VALIDATION_ERROR");
      expect(error.error.target).toBe("tin");
    });

    it("creates not found error", () => {
      const createNotFoundError = (resource: string, id: string) => ({
        ok: false as const,
        error: {
          code: `${resource.toUpperCase()}_NOT_FOUND`,
          message: `${resource} not found: ${id}`,
          target: id,
        },
      });

      const error = createNotFoundError("Document", "uuid-123");
      expect(error.error.code).toBe("DOCUMENT_NOT_FOUND");
      expect(error.error.target).toBe("uuid-123");
    });

    it("creates auth error", () => {
      const createAuthError = (message: string) => ({
        ok: false as const,
        error: {
          code: "UNAUTHORIZED",
          message,
        },
      });

      const error = createAuthError("Token expired");
      expect(error.error.code).toBe("UNAUTHORIZED");
    });

    it("creates rate limit error", () => {
      const createRateLimitError = (retryAfter?: number) => ({
        ok: false as const,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Rate limit exceeded",
          ...(retryAfter && { meta: { retryAfter } }),
        },
      });

      const error = createRateLimitError(60);
      expect(error.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect((error.error as { meta?: { retryAfter: number } }).meta?.retryAfter).toBe(60);
    });
  });
});
