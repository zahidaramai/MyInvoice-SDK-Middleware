import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import forge from "node-forge";
import * as crypto from "crypto";
import {
  loadPKCS12,
  loadPKCS12FromFile,
  loadPKCS12FromBase64,
  isPKCS12File,
} from "../src/pkcs12-loader.js";
import { CertificateLoadError, PrivateKeyLoadError } from "../src/errors.js";

// Mock fs module
vi.mock("fs");

// Helper to create a test PKCS#12 buffer using node-forge
function createTestP12(passphrase: string): Buffer {
  // Generate a test key pair
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });

  // Create a self-signed certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: "commonName", value: "Test Certificate" },
    { name: "countryName", value: "MY" },
    { name: "organizationName", value: "Test Org" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // Sign the certificate
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Create PKCS#12
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: "3des",
  });

  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, "binary");
}

describe("isPKCS12File", () => {
  it("returns true for .p12 files", () => {
    expect(isPKCS12File("/path/to/cert.p12")).toBe(true);
    expect(isPKCS12File("cert.P12")).toBe(true);
  });

  it("returns true for .pfx files", () => {
    expect(isPKCS12File("/path/to/cert.pfx")).toBe(true);
    expect(isPKCS12File("cert.PFX")).toBe(true);
  });

  it("returns false for other file types", () => {
    expect(isPKCS12File("/path/to/cert.pem")).toBe(false);
    expect(isPKCS12File("/path/to/cert.crt")).toBe(false);
    expect(isPKCS12File("/path/to/key.key")).toBe(false);
  });
});

describe("loadPKCS12", () => {
  const testPassphrase = "testpass123";
  let testP12Buffer: Buffer;

  beforeEach(() => {
    vi.resetAllMocks();
    testP12Buffer = createTestP12(testPassphrase);
  });

  describe("with file path", () => {
    it("loads certificate and key from P12 file", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(testP12Buffer);

      const result = loadPKCS12({
        path: "/path/to/test.p12",
        passphrase: testPassphrase,
      });

      expect(result.certPem).toContain("-----BEGIN CERTIFICATE-----");
      expect(result.certPem).toContain("-----END CERTIFICATE-----");
      expect(result.privateKey).toBeInstanceOf(crypto.KeyObject);
      expect(result.certInfo.subject.commonName).toBe("Test Certificate");
    });

    it("throws CertificateLoadError when file does not exist", () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      expect(() =>
        loadPKCS12({
          path: "/path/to/nonexistent.p12",
          passphrase: testPassphrase,
        })
      ).toThrow(CertificateLoadError);
    });
  });

  describe("with base64", () => {
    it("loads certificate and key from base64-encoded P12", () => {
      const base64 = testP12Buffer.toString("base64");

      const result = loadPKCS12({
        base64,
        passphrase: testPassphrase,
      });

      expect(result.certPem).toContain("-----BEGIN CERTIFICATE-----");
      expect(result.privateKey).toBeInstanceOf(crypto.KeyObject);
    });

    it("throws CertificateLoadError for invalid base64", () => {
      expect(() =>
        loadPKCS12({
          base64: "not-valid-base64!!!",
          passphrase: testPassphrase,
        })
      ).toThrow(CertificateLoadError);
    });
  });

  describe("validation", () => {
    it("throws CertificateLoadError when neither path nor base64 is provided", () => {
      expect(() => loadPKCS12({})).toThrow(CertificateLoadError);
      expect(() => loadPKCS12({})).toThrow("PKCS#12 source must specify either path or base64");
    });

    it("throws PrivateKeyLoadError for wrong passphrase", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(testP12Buffer);

      expect(() =>
        loadPKCS12({
          path: "/path/to/test.p12",
          passphrase: "wrong-password",
        })
      ).toThrow(PrivateKeyLoadError);
    });

    it("works with empty passphrase when P12 has no password", () => {
      const unprotectedP12 = createTestP12("");
      vi.mocked(fs.readFileSync).mockReturnValue(unprotectedP12);

      const result = loadPKCS12({
        path: "/path/to/test.p12",
        // No passphrase - defaults to empty string
      });

      expect(result.certPem).toContain("-----BEGIN CERTIFICATE-----");
    });
  });
});

describe("loadPKCS12FromFile", () => {
  it("calls loadPKCS12 with file path source", () => {
    const testP12 = createTestP12("pass");
    vi.mocked(fs.readFileSync).mockReturnValue(testP12);

    const result = loadPKCS12FromFile("/path/to/cert.p12", "pass");

    expect(result.certPem).toContain("-----BEGIN CERTIFICATE-----");
    expect(fs.readFileSync).toHaveBeenCalledWith("/path/to/cert.p12");
  });
});

describe("loadPKCS12FromBase64", () => {
  it("calls loadPKCS12 with base64 source", () => {
    const testP12 = createTestP12("pass");
    const base64 = testP12.toString("base64");

    const result = loadPKCS12FromBase64(base64, "pass");

    expect(result.certPem).toContain("-----BEGIN CERTIFICATE-----");
  });
});
