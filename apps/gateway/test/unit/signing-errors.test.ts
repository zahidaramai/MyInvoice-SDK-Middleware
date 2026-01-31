/**
 * Signing Error Transformation Tests
 *
 * Tests for the signing error transformation functionality (US-027, US-028).
 */

import { describe, it, expect } from "vitest";
import {
  transformSigningError,
  isSigningError,
  createSigningNotConfiguredError,
  createSigningDisabledError,
  createInvalidDocumentVersionError,
  type SigningErrorContext,
} from "../../src/errors/signing-errors.js";
import {
  CertificateLoadError,
  PrivateKeyLoadError,
  CertificateExpiredError,
  CertificateNotYetValidError,
  KeyCertificateMismatchError,
  SignatureGenerationError,
  SignatureVerificationError,
  SigningError,
  SigningErrorCode,
} from "@myinvois/signing";
import { ErrorCodes } from "@myinvois/core";

describe("signing-errors", () => {
  describe("transformSigningError", () => {
    it("transforms CertificateLoadError correctly", () => {
      const error = new CertificateLoadError("Failed to read certificate file");
      const result = transformSigningError(error, { phase: "loading" }, "corr-123");

      expect(result.code).toBe(ErrorCodes.CERTIFICATE_LOAD_FAILED);
      expect(result.messageEN).toContain("Failed to load signing certificate");
      expect(result.httpStatus).toBe(500);
      expect(result.retryable).toBe(false);
      expect(result.correlationId).toBe("corr-123");
      expect(result.signing?.phase).toBe("loading");
    });

    it("transforms CertificateExpiredError with certificate subject", () => {
      const error = new CertificateExpiredError(
        "Certificate expired on 2024-01-01",
        new Date("2024-01-01"),
        { subject: "CN=Test Cert, O=Test Org" }
      );
      const result = transformSigningError(error, {}, "corr-456");

      expect(result.code).toBe(ErrorCodes.CERTIFICATE_EXPIRED);
      expect(result.messageEN).toContain("Certificate expired");
      expect(result.httpStatus).toBe(503);
      expect(result.retryable).toBe(false);
      expect(result.signing?.phase).toBe("loading");
      expect(result.signing?.certificateSubject).toBe("CN=Test Cert, O=Test Org");
    });

    it("transforms CertificateNotYetValidError with certificate subject", () => {
      const error = new CertificateNotYetValidError(
        "Certificate not valid until 2025-01-01",
        new Date("2025-01-01"),
        { subject: "CN=Future Cert" }
      );
      const result = transformSigningError(error);

      expect(result.code).toBe(ErrorCodes.CERTIFICATE_NOT_YET_VALID);
      expect(result.httpStatus).toBe(503);
      expect(result.signing?.certificateSubject).toBe("CN=Future Cert");
    });

    it("transforms PrivateKeyLoadError correctly", () => {
      const error = new PrivateKeyLoadError("Invalid key format");
      const result = transformSigningError(error, { phase: "loading" });

      expect(result.code).toBe(ErrorCodes.PRIVATE_KEY_LOAD_FAILED);
      expect(result.messageEN).toContain("Failed to load private key");
      expect(result.httpStatus).toBe(500);
      expect(result.signing?.phase).toBe("loading");
    });

    it("transforms KeyCertificateMismatchError correctly", () => {
      const error = new KeyCertificateMismatchError(
        "Key does not match certificate",
        { certificateSubject: "CN=Test" }
      );
      const result = transformSigningError(error);

      expect(result.code).toBe(ErrorCodes.KEY_CERTIFICATE_MISMATCH);
      expect(result.httpStatus).toBe(500);
      expect(result.signing?.certificateSubject).toBe("CN=Test");
    });

    it("transforms SignatureGenerationError correctly", () => {
      const error = new SignatureGenerationError("Signing algorithm failed");
      const result = transformSigningError(error, { phase: "signing" });

      expect(result.code).toBe(ErrorCodes.SIGNING_FAILED);
      expect(result.messageEN).toContain("Failed to generate signature");
      expect(result.httpStatus).toBe(500);
      expect(result.signing?.phase).toBe("signing");
    });

    it("transforms SignatureVerificationError correctly", () => {
      const error = new SignatureVerificationError("Signature mismatch", "invalid_signature");
      const result = transformSigningError(error, { phase: "verification" });

      expect(result.code).toBe(ErrorCodes.SIGNATURE_VERIFICATION_FAILED);
      expect(result.httpStatus).toBe(400);
      expect(result.signing?.phase).toBe("verification");
    });

    it("transforms generic SigningError correctly", () => {
      const error = new SigningError(SigningErrorCode.SIGNING_FAILED, "Generic signing failure");
      const result = transformSigningError(error);

      expect(result.code).toBe(ErrorCodes.SIGNING_FAILED);
      expect(result.httpStatus).toBe(500);
    });

    it("transforms unknown errors with fallback", () => {
      const error = new Error("Random error");
      const result = transformSigningError(error);

      expect(result.code).toBe(ErrorCodes.SIGNING_FAILED);
      expect(result.messageEN).toBe("Random error");
      expect(result.httpStatus).toBe(500);
    });

    it("includes context in transformed errors", () => {
      const error = new SigningError(SigningErrorCode.SIGNING_FAILED, "Test error");
      const context: Partial<SigningErrorContext> = {
        phase: "signing",
        documentVersion: "1.1",
        documentCodeNumber: "INV-001",
      };
      const result = transformSigningError(error, context, "corr-789");

      expect(result.signing?.phase).toBe("signing");
      expect(result.signing?.documentVersion).toBe("1.1");
      expect(result.signing?.documentCodeNumber).toBe("INV-001");
      expect(result.correlationId).toBe("corr-789");
    });
  });

  describe("isSigningError", () => {
    it("returns true for SigningError", () => {
      expect(isSigningError(new SigningError(SigningErrorCode.SIGNING_FAILED, "test"))).toBe(true);
    });

    it("returns true for CertificateLoadError", () => {
      expect(isSigningError(new CertificateLoadError("test"))).toBe(true);
    });

    it("returns true for PrivateKeyLoadError", () => {
      expect(isSigningError(new PrivateKeyLoadError("test"))).toBe(true);
    });

    it("returns true for CertificateExpiredError", () => {
      const error = new CertificateExpiredError("test", new Date(), { subject: "CN=Test" });
      expect(isSigningError(error)).toBe(true);
    });

    it("returns true for CertificateNotYetValidError", () => {
      const error = new CertificateNotYetValidError("test", new Date(), { subject: "CN=Test" });
      expect(isSigningError(error)).toBe(true);
    });

    it("returns true for KeyCertificateMismatchError", () => {
      expect(isSigningError(new KeyCertificateMismatchError("test"))).toBe(true);
    });

    it("returns true for SignatureGenerationError", () => {
      expect(isSigningError(new SignatureGenerationError("test"))).toBe(true);
    });

    it("returns true for SignatureVerificationError", () => {
      expect(isSigningError(new SignatureVerificationError("test", "invalid_signature"))).toBe(true);
    });

    it("returns false for generic Error", () => {
      expect(isSigningError(new Error("test"))).toBe(false);
    });

    it("returns false for non-error values", () => {
      expect(isSigningError("string")).toBe(false);
      expect(isSigningError(null)).toBe(false);
      expect(isSigningError(undefined)).toBe(false);
      expect(isSigningError({})).toBe(false);
    });
  });

  describe("createSigningNotConfiguredError", () => {
    it("creates correct error envelope", () => {
      const result = createSigningNotConfiguredError("1.1", "corr-123");

      expect(result.code).toBe(ErrorCodes.SIGNING_NOT_CONFIGURED);
      expect(result.messageEN).toContain("Signing is required for document version 1.1");
      expect(result.httpStatus).toBe(503);
      expect(result.retryable).toBe(false);
      expect(result.correlationId).toBe("corr-123");
      expect(result.signing?.phase).toBe("loading");
      expect(result.signing?.documentVersion).toBe("1.1");
    });
  });

  describe("createSigningDisabledError", () => {
    it("creates correct error envelope", () => {
      const result = createSigningDisabledError("corr-456");

      expect(result.code).toBe(ErrorCodes.SIGNING_DISABLED);
      expect(result.messageEN).toContain("Document signing is disabled");
      expect(result.httpStatus).toBe(503);
      expect(result.retryable).toBe(false);
      expect(result.correlationId).toBe("corr-456");
      expect(result.signing?.phase).toBe("loading");
    });
  });

  describe("createInvalidDocumentVersionError", () => {
    it("creates correct error envelope", () => {
      const result = createInvalidDocumentVersionError("2.0", "corr-789");

      expect(result.code).toBe(ErrorCodes.INVALID_DOCUMENT_VERSION);
      expect(result.messageEN).toContain("Invalid document version: 2.0");
      expect(result.messageEN).toContain("Valid versions are '1.0' and '1.1'");
      expect(result.httpStatus).toBe(400);
      expect(result.retryable).toBe(false);
      expect(result.correlationId).toBe("corr-789");
      expect(result.signing?.phase).toBe("loading");
      expect(result.signing?.documentVersion).toBe("2.0");
    });
  });

  describe("SigningErrorEnvelope structure", () => {
    it("includes all required fields", () => {
      const error = new SigningError(SigningErrorCode.SIGNING_FAILED, "Test");
      const result = transformSigningError(error, {
        phase: "signing",
        certificateSubject: "CN=Test",
        documentVersion: "1.1",
        documentCodeNumber: "INV-001",
      }, "test-correlation");

      // ErrorEnvelope base fields
      expect(result).toHaveProperty("code");
      expect(result).toHaveProperty("messageEN");
      expect(result).toHaveProperty("httpStatus");
      expect(result).toHaveProperty("retryable");
      expect(result).toHaveProperty("correlationId");

      // SigningErrorContext fields
      expect(result).toHaveProperty("signing");
      expect(result.signing).toHaveProperty("phase");
      expect(result.signing).toHaveProperty("certificateSubject");
      expect(result.signing).toHaveProperty("documentVersion");
      expect(result.signing).toHaveProperty("documentCodeNumber");
    });

    it("signing context phase is from valid values", () => {
      const phases: Array<"loading" | "signing" | "verification"> = [
        "loading",
        "signing",
        "verification",
      ];

      for (const phase of phases) {
        const result = transformSigningError(
          new SigningError(SigningErrorCode.SIGNING_FAILED, "test"),
          { phase }
        );
        expect(result.signing?.phase).toBe(phase);
      }
    });
  });
});
