/**
 * Actual tests for stableHash module
 */

import { describe, it, expect } from "vitest";
import {
  sha256,
  sha256Short,
  sessionFingerprint,
  computeDocumentHash,
  prepareDocumentForSubmission,
} from "../../src/crypto/stableHash.js";

describe("stableHash (actual)", () => {
  describe("sha256", () => {
    it("produces consistent hash for same input", () => {
      const hash1 = sha256("test input");
      const hash2 = sha256("test input");
      expect(hash1).toBe(hash2);
    });

    it("produces different hash for different input", () => {
      const hash1 = sha256("input1");
      const hash2 = sha256("input2");
      expect(hash1).not.toBe(hash2);
    });

    it("produces 64-character hex string", () => {
      const hash = sha256("any input");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it("handles empty string", () => {
      const hash = sha256("");
      expect(hash).toHaveLength(64);
    });

    it("handles unicode characters", () => {
      const hash = sha256("日本語テスト");
      expect(hash).toHaveLength(64);
    });
  });

  describe("sha256Short", () => {
    it("returns default 12 characters", () => {
      const hash = sha256Short("test");
      expect(hash).toHaveLength(12);
    });

    it("returns custom length", () => {
      const hash = sha256Short("test", 8);
      expect(hash).toHaveLength(8);
    });

    it("is consistent for same input", () => {
      const hash1 = sha256Short("hello");
      const hash2 = sha256Short("hello");
      expect(hash1).toBe(hash2);
    });

    it("is prefix of full hash", () => {
      const full = sha256("test input");
      const short = sha256Short("test input", 16);
      expect(full.startsWith(short)).toBe(true);
    });
  });

  describe("sessionFingerprint", () => {
    it("produces consistent fingerprint for same components", () => {
      const fp1 = sessionFingerprint("SANDBOX", "TAXPAYER", "client123");
      const fp2 = sessionFingerprint("SANDBOX", "TAXPAYER", "client123");
      expect(fp1).toBe(fp2);
    });

    it("produces different fingerprint for different env", () => {
      const fp1 = sessionFingerprint("SANDBOX", "TAXPAYER", "client123");
      const fp2 = sessionFingerprint("PROD", "TAXPAYER", "client123");
      expect(fp1).not.toBe(fp2);
    });

    it("produces different fingerprint for different mode", () => {
      const fp1 = sessionFingerprint("SANDBOX", "TAXPAYER", "client123");
      const fp2 = sessionFingerprint("SANDBOX", "INTERMEDIARY", "client123");
      expect(fp1).not.toBe(fp2);
    });

    it("produces different fingerprint for different clientId", () => {
      const fp1 = sessionFingerprint("SANDBOX", "TAXPAYER", "client123");
      const fp2 = sessionFingerprint("SANDBOX", "TAXPAYER", "client456");
      expect(fp1).not.toBe(fp2);
    });

    it("includes onBehalfOf in fingerprint", () => {
      const fp1 = sessionFingerprint("SANDBOX", "INTERMEDIARY", "client123", "C12345");
      const fp2 = sessionFingerprint("SANDBOX", "INTERMEDIARY", "client123", "C67890");
      expect(fp1).not.toBe(fp2);
    });

    it("handles missing onBehalfOf", () => {
      const fp1 = sessionFingerprint("SANDBOX", "TAXPAYER", "client123");
      const fp2 = sessionFingerprint("SANDBOX", "TAXPAYER", "client123", undefined);
      expect(fp1).toBe(fp2);
    });

    it("returns 12-character fingerprint", () => {
      const fp = sessionFingerprint("SANDBOX", "TAXPAYER", "client123");
      expect(fp).toHaveLength(12);
    });
  });

  describe("computeDocumentHash", () => {
    it("produces hex-encoded SHA-256 hash", () => {
      const jsonString = '{"id":"INV001","amount":100}';
      const hash = computeDocumentHash(jsonString);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it("is consistent for same input", () => {
      const json = '{"test":"value"}';
      const hash1 = computeDocumentHash(json);
      const hash2 = computeDocumentHash(json);
      expect(hash1).toBe(hash2);
    });

    it("produces different hash for different content", () => {
      const hash1 = computeDocumentHash('{"id":"1"}');
      const hash2 = computeDocumentHash('{"id":"2"}');
      expect(hash1).not.toBe(hash2);
    });

    it("handles complex JSON", () => {
      const complexJson = JSON.stringify({
        Invoice: [{
          ID: [{ _: "INV001" }],
          TaxTotal: [{ TaxAmount: [{ _: 8.00, currencyID: "MYR" }] }],
          InvoiceLine: [
            { ID: [{ _: "1" }], Item: [{ Description: [{ _: "Product A" }] }] },
            { ID: [{ _: "2" }], Item: [{ Description: [{ _: "Product B" }] }] },
          ],
        }],
      });

      const hash = computeDocumentHash(complexJson);
      expect(hash).toHaveLength(64);
    });

    it("handles unicode in JSON", () => {
      const jsonWithUnicode = '{"name":"日本語","value":"中文"}';
      const hash = computeDocumentHash(jsonWithUnicode);
      expect(hash).toHaveLength(64);
    });

    it("is sensitive to whitespace", () => {
      const compact = '{"a":"b"}';
      const withSpaces = '{ "a": "b" }';
      const hash1 = computeDocumentHash(compact);
      const hash2 = computeDocumentHash(withSpaces);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("prepareDocumentForSubmission", () => {
    it("returns document and documentHash", () => {
      const signedDoc = { id: "INV001", amount: 100 };
      const result = prepareDocumentForSubmission(signedDoc);

      expect(result).toHaveProperty("document");
      expect(result).toHaveProperty("documentHash");
    });

    it("returns base64-encoded document", () => {
      const signedDoc = { id: "INV001" };
      const result = prepareDocumentForSubmission(signedDoc);

      // Verify it's valid base64
      const decoded = Buffer.from(result.document, "base64").toString("utf-8");
      expect(JSON.parse(decoded)).toEqual(signedDoc);
    });

    it("returns hex-encoded hash", () => {
      const signedDoc = { id: "INV001" };
      const result = prepareDocumentForSubmission(signedDoc);

      expect(result.documentHash).toHaveLength(64);
      expect(result.documentHash).toMatch(/^[0-9a-f]+$/);
    });

    it("hash matches document content", () => {
      const signedDoc = { id: "INV001", data: "test" };
      const result = prepareDocumentForSubmission(signedDoc);

      // Compute expected hash from the base64-decoded document
      const jsonString = JSON.stringify(signedDoc);
      const expectedHash = computeDocumentHash(jsonString);

      expect(result.documentHash).toBe(expectedHash);
    });

    it("handles complex nested document", () => {
      const signedDoc = {
        _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
        Invoice: [{
          ID: [{ _: "INV001" }],
          IssueDate: [{ _: "2024-01-15" }],
          AccountingSupplierParty: [{
            Party: [{
              PartyIdentification: [
                { ID: [{ _: "C12345", schemeID: "TIN" }] },
              ],
            }],
          }],
          InvoiceLine: [
            {
              ID: [{ _: "1" }],
              LineExtensionAmount: [{ _: 100, currencyID: "MYR" }],
            },
          ],
        }],
      };

      const result = prepareDocumentForSubmission(signedDoc);

      // Verify we can decode and parse the document
      const decoded = Buffer.from(result.document, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);
      expect(parsed._D).toBe("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2");
    });

    it("produces consistent results", () => {
      const signedDoc = { test: "consistent" };
      const result1 = prepareDocumentForSubmission(signedDoc);
      const result2 = prepareDocumentForSubmission(signedDoc);

      expect(result1.document).toBe(result2.document);
      expect(result1.documentHash).toBe(result2.documentHash);
    });
  });
});
