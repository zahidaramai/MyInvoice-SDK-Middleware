import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  loadCertificate,
  loadCertificateFromFile,
  loadCertificateFromBase64,
  loadCertificateFromEnv,
  parseCertificate,
  validateCertificate,
  getX509Certificate,
} from "../src/certificate-loader.js";
import {
  CertificateLoadError,
  CertificateExpiredError,
  CertificateNotYetValidError,
} from "../src/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

describe("Certificate Loader", () => {
  const validCertPath = path.join(fixturesDir, "valid-cert.pem");
  const ecCertPath = path.join(fixturesDir, "ec-cert.pem");

  describe("loadCertificateFromFile", () => {
    it("loads certificate from valid file path", () => {
      const pem = loadCertificateFromFile(validCertPath);
      expect(pem).toContain("-----BEGIN CERTIFICATE-----");
      expect(pem).toContain("-----END CERTIFICATE-----");
    });

    it("throws CertificateLoadError for non-existent file", () => {
      expect(() => loadCertificateFromFile("/non/existent/path.pem")).toThrow(CertificateLoadError);
    });

    it("throws CertificateLoadError for directory path", () => {
      expect(() => loadCertificateFromFile(fixturesDir)).toThrow(CertificateLoadError);
    });
  });

  describe("loadCertificateFromBase64", () => {
    it("loads certificate from base64 encoded data", () => {
      const originalPem = fs.readFileSync(validCertPath, "utf-8");
      const base64 = Buffer.from(originalPem).toString("base64");

      const decoded = loadCertificateFromBase64(base64);
      expect(decoded).toBe(originalPem);
    });

    it("handles empty base64 string", () => {
      const decoded = loadCertificateFromBase64("");
      expect(decoded).toBe("");
    });
  });

  describe("loadCertificateFromEnv", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("loads certificate from environment variable", () => {
      const certContent = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----";
      process.env.TEST_CERT = certContent;

      const result = loadCertificateFromEnv("TEST_CERT");
      expect(result).toBe(certContent);
    });

    it("throws CertificateLoadError for missing env var", () => {
      delete process.env.MISSING_CERT;
      expect(() => loadCertificateFromEnv("MISSING_CERT")).toThrow(CertificateLoadError);
    });

    it("throws CertificateLoadError for empty env var", () => {
      process.env.EMPTY_CERT = "";
      expect(() => loadCertificateFromEnv("EMPTY_CERT")).toThrow(CertificateLoadError);
    });
  });

  describe("loadCertificate", () => {
    it("loads certificate from file source", () => {
      const result = loadCertificate({ path: validCertPath });
      expect(result.pem).toContain("-----BEGIN CERTIFICATE-----");
      expect(result.info.subject.commonName).toBe("Test Certificate");
    });

    it("loads certificate from base64 source", () => {
      const originalPem = fs.readFileSync(validCertPath, "utf-8");
      const base64 = Buffer.from(originalPem).toString("base64");

      const result = loadCertificate({ base64 });
      expect(result.info.subject.commonName).toBe("Test Certificate");
    });

    it("throws when no source specified", () => {
      expect(() => loadCertificate({})).toThrow(CertificateLoadError);
    });
  });

  describe("parseCertificate", () => {
    it("parses RSA certificate correctly", () => {
      const pem = fs.readFileSync(validCertPath, "utf-8");
      const info = parseCertificate(pem);

      expect(info.subject.commonName).toBe("Test Certificate");
      expect(info.subject.organization).toBe("Test Organization");
      expect(info.subject.organizationalUnit).toBe("Test Unit");
      expect(info.subject.country).toBe("MY");
      expect(info.subject.state).toBe("Selangor");
      expect(info.subject.locality).toBe("Kuala Lumpur");

      expect(info.issuer).toBeDefined();
      expect(info.serialNumber).toBeDefined();
      expect(info.validFrom).toBeInstanceOf(Date);
      expect(info.validTo).toBeInstanceOf(Date);
      expect(info.keyType).toBe("RSA");
      expect(info.keySize).toBe(2048);
      expect(info.fingerprint).toMatch(/^[A-F0-9:]+$/);
    });

    it("parses EC certificate correctly", () => {
      const pem = fs.readFileSync(ecCertPath, "utf-8");
      const info = parseCertificate(pem);

      expect(info.keyType).toBe("EC");
      expect(info.keySize).toBe(256); // P-256 curve
    });

    it("calculates validity status correctly", () => {
      const pem = fs.readFileSync(validCertPath, "utf-8");
      const info = parseCertificate(pem);

      // Certificate should be valid (not expired, not future)
      expect(info.isValid).toBe(true);
      expect(info.isExpired).toBe(false);
      expect(info.isNotYetValid).toBe(false);
      expect(info.daysUntilExpiry).toBeGreaterThan(0);
    });

    it("throws CertificateLoadError for invalid PEM", () => {
      expect(() => parseCertificate("not a certificate")).toThrow(CertificateLoadError);
    });

    it("throws CertificateLoadError for empty string", () => {
      expect(() => parseCertificate("")).toThrow(CertificateLoadError);
    });
  });

  describe("validateCertificate", () => {
    it("does not throw for valid certificate", () => {
      const pem = fs.readFileSync(validCertPath, "utf-8");
      const info = parseCertificate(pem);

      expect(() => validateCertificate(info)).not.toThrow();
    });

    it("throws CertificateExpiredError for expired certificate", () => {
      // Create a fake expired certificate info
      const expiredInfo = {
        subject: { raw: "CN=Expired", commonName: "Expired" },
        issuer: { raw: "CN=Issuer" },
        serialNumber: "123",
        validFrom: new Date("2020-01-01"),
        validTo: new Date("2020-12-31"),
        isValid: false,
        isExpired: true,
        isNotYetValid: false,
        daysUntilExpiry: -365,
        fingerprint: "AA:BB:CC",
        keyType: "RSA",
        keySize: 2048,
      };

      expect(() => validateCertificate(expiredInfo)).toThrow(CertificateExpiredError);
    });

    it("throws CertificateNotYetValidError for future certificate", () => {
      // Create a fake future certificate info
      const futureInfo = {
        subject: { raw: "CN=Future", commonName: "Future" },
        issuer: { raw: "CN=Issuer" },
        serialNumber: "123",
        validFrom: new Date("2030-01-01"),
        validTo: new Date("2030-12-31"),
        isValid: false,
        isExpired: false,
        isNotYetValid: true,
        daysUntilExpiry: 365,
        fingerprint: "AA:BB:CC",
        keyType: "RSA",
        keySize: 2048,
      };

      expect(() => validateCertificate(futureInfo)).toThrow(CertificateNotYetValidError);
    });
  });

  describe("getX509Certificate", () => {
    it("returns X509Certificate object", () => {
      const pem = fs.readFileSync(validCertPath, "utf-8");
      const cert = getX509Certificate(pem);

      expect(cert).toBeDefined();
      expect(cert.subject).toContain("CN=Test Certificate");
    });

    it("throws CertificateLoadError for invalid PEM", () => {
      expect(() => getX509Certificate("invalid pem")).toThrow(CertificateLoadError);
    });
  });
});
