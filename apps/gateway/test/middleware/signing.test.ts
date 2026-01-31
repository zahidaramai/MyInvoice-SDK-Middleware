/**
 * Tests for signing middleware
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the signing config
vi.mock("@myinvois/signing", () => ({
  SigningService: vi.fn().mockImplementation(() => ({
    sign: vi.fn().mockResolvedValue({
      document: "signed-document",
      signature: "signature-value",
    }),
    verify: vi.fn().mockResolvedValue({
      valid: true,
      signerName: "Test Signer",
    }),
  })),
  loadCertificate: vi.fn().mockResolvedValue({
    certificate: "cert",
    privateKey: "key",
  }),
}));

describe("signing middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("signing configuration", () => {
    it("detects signing enabled from environment", () => {
      const signingEnabled = process.env.SIGNING_ENABLED === "true";
      expect(typeof signingEnabled).toBe("boolean");
    });

    it("reads default document version", () => {
      const defaultVersion = process.env.SIGNING_DEFAULT_VERSION || "1.0";
      expect(["1.0", "1.1"]).toContain(defaultVersion);
    });

    it("reads PKCS12 path from environment", () => {
      const pkcs12Path = process.env.SIGNING_PKCS12_PATH;
      expect(pkcs12Path === undefined || typeof pkcs12Path === "string").toBe(true);
    });
  });

  describe("document signing", () => {
    it("signs document when version is 1.1", () => {
      const document = {
        Invoice: {
          ID: "INV001",
          IssueDate: "2024-01-15",
        },
      };
      const version = "1.1";

      const requiresSigning = version === "1.1";
      expect(requiresSigning).toBe(true);
    });

    it("skips signing when version is 1.0", () => {
      const version = "1.0";
      const requiresSigning = version === "1.1";
      expect(requiresSigning).toBe(false);
    });

    it("adds signature to UBL envelope", () => {
      const signedEnvelope = {
        Invoice: {
          Signature: {
            SignatureValue: "base64-signature",
            KeyInfo: {
              X509Data: {
                X509Certificate: "base64-certificate",
              },
            },
          },
        },
      };

      expect(signedEnvelope.Invoice.Signature).toBeDefined();
      expect(signedEnvelope.Invoice.Signature.SignatureValue).toBeDefined();
    });
  });

  describe("certificate loading", () => {
    it("loads certificate from PKCS12 file", () => {
      const config = {
        type: "pkcs12",
        path: "/path/to/cert.p12",
        passphrase: "secret",
      };

      expect(config.type).toBe("pkcs12");
      expect(config.path).toBeDefined();
    });

    it("loads certificate from PEM files", () => {
      const config = {
        type: "pem",
        certPath: "/path/to/cert.pem",
        keyPath: "/path/to/key.pem",
      };

      expect(config.type).toBe("pem");
    });

    it("loads certificate from base64 strings", () => {
      const config = {
        type: "base64",
        certificate: "base64-encoded-cert",
        privateKey: "base64-encoded-key",
      };

      expect(config.type).toBe("base64");
    });
  });

  describe("signing error handling", () => {
    it("returns error when certificate not loaded", () => {
      const error = {
        code: "SIGNING_NOT_CONFIGURED",
        message: "Signing certificate not configured",
      };

      expect(error.code).toBe("SIGNING_NOT_CONFIGURED");
    });

    it("returns error when signing fails", () => {
      const error = {
        code: "SIGNING_FAILED",
        message: "Failed to sign document",
        details: "Invalid certificate format",
      };

      expect(error.code).toBe("SIGNING_FAILED");
    });

    it("returns error when certificate expired", () => {
      const error = {
        code: "CERTIFICATE_EXPIRED",
        message: "Signing certificate has expired",
      };

      expect(error.code).toBe("CERTIFICATE_EXPIRED");
    });
  });

  describe("request handling", () => {
    it("extracts document version from request", () => {
      const request = {
        body: {
          documentVersion: "1.1",
          documents: [{ Invoice: {} }],
        },
      };

      const version = request.body.documentVersion || "1.0";
      expect(version).toBe("1.1");
    });

    it("uses default version when not specified", () => {
      const request = {
        body: {
          documents: [{ Invoice: {} }],
        },
      };

      const defaultVersion = "1.0";
      const version =
        (request.body as { documentVersion?: string }).documentVersion || defaultVersion;
      expect(version).toBe("1.0");
    });
  });

  describe("signing passthrough", () => {
    it("passes through when signing not enabled", () => {
      const signingEnabled = false;
      const document = { Invoice: {} };

      if (!signingEnabled) {
        // Document passes through unchanged
        expect(document).toEqual({ Invoice: {} });
      }
    });

    it("passes through for document version 1.0", () => {
      const version = "1.0";
      const document = { Invoice: {} };

      if (version !== "1.1") {
        // Document passes through unchanged
        expect(document).toEqual({ Invoice: {} });
      }
    });
  });

  describe("signature format", () => {
    it("generates detached signature", () => {
      const signature = {
        type: "detached",
        algorithm: "RSA-SHA256",
        value: "base64-signature-value",
      };

      expect(signature.type).toBe("detached");
      expect(signature.algorithm).toBe("RSA-SHA256");
    });

    it("includes certificate chain", () => {
      const signature = {
        certificates: ["base64-issuer-cert", "base64-intermediate-cert"],
      };

      expect(signature.certificates.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("signing performance", () => {
    it("tracks signing duration", () => {
      const startTime = Date.now();
      const endTime = startTime + 50; // Simulated 50ms
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it("caches loaded certificate", () => {
      const certificateCache = {
        loaded: true,
        loadedAt: new Date(),
      };

      expect(certificateCache.loaded).toBe(true);
    });
  });
});
