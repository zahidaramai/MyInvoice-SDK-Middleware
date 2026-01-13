/**
 * Performance Tests for @myinvois/signing
 *
 * Tests signing performance (US-037).
 * Target: <100ms per document for signing operations.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  sign,
  SigningService,
  VerificationService,
  parseCertificate,
  parsePrivateKey,
} from "../src/index.js";
import type { CertificateInfo } from "../src/types.js";
import type { KeyObject } from "crypto";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

describe("signing performance", () => {
  let privateKey: KeyObject;
  let certPem: string;
  let certInfo: CertificateInfo;
  let signingService: SigningService;
  let verificationService: VerificationService;

  const testDocument = {
    ID: [{ _: "INV-PERF-001" }],
    IssueDate: [{ _: "2025-01-13" }],
    InvoiceTypeCode: [{ _: "01", listVersionID: "1.1" }],
    AccountingSupplierParty: [
      {
        Party: [
          {
            PartyIdentification: [{ ID: [{ _: "C12345678901", schemeID: "TIN" }] }],
            PartyLegalEntity: [{ RegistrationName: [{ _: "Test Supplier Sdn Bhd" }] }],
          },
        ],
      },
    ],
    AccountingCustomerParty: [
      {
        Party: [
          {
            PartyIdentification: [{ ID: [{ _: "C98765432109", schemeID: "TIN" }] }],
            PartyLegalEntity: [{ RegistrationName: [{ _: "Test Customer Sdn Bhd" }] }],
          },
        ],
      },
    ],
    LegalMonetaryTotal: [
      {
        PayableAmount: [{ _: 1000.0, currencyID: "MYR" }],
      },
    ],
    InvoiceLine: [
      {
        ID: [{ _: "1" }],
        InvoicedQuantity: [{ _: 1, unitCode: "EA" }],
        LineExtensionAmount: [{ _: 1000.0, currencyID: "MYR" }],
        Item: [{ Description: [{ _: "Test Item" }] }],
        Price: [{ PriceAmount: [{ _: 1000.0, currencyID: "MYR" }] }],
      },
    ],
  };

  beforeAll(() => {
    const keyPem = fs.readFileSync(path.join(fixturesDir, "valid-key.pem"), "utf-8");
    certPem = fs.readFileSync(path.join(fixturesDir, "valid-cert.pem"), "utf-8");

    privateKey = parsePrivateKey(keyPem);
    certInfo = parseCertificate(certPem);

    signingService = new SigningService(privateKey, certPem, certInfo);
    verificationService = new VerificationService();
  });

  describe("single document signing", () => {
    it("signs a document in <100ms", () => {
      const start = performance.now();
      const result = sign(testDocument, privateKey, certPem, certInfo);
      const duration = performance.now() - start;

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(100);
      console.log(`Single document signing: ${duration.toFixed(2)}ms`);
    });

    it("verifies a document in <100ms", () => {
      const signed = sign(testDocument, privateKey, certPem, certInfo);

      const start = performance.now();
      const result = verificationService.verify(signed.signedDocument);
      const duration = performance.now() - start;

      expect(result.valid).toBe(true);
      expect(duration).toBeLessThan(100);
      console.log(`Single document verification: ${duration.toFixed(2)}ms`);
    });

    it("SigningService.sign works in <100ms", () => {
      const start = performance.now();
      const result = signingService.sign(testDocument);
      const duration = performance.now() - start;

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(100);
      console.log(`SigningService.sign: ${duration.toFixed(2)}ms`);
    });
  });

  describe("concurrent signing", () => {
    it("signs 10 documents concurrently in reasonable time", async () => {
      const documents = Array(10)
        .fill(null)
        .map((_, i) => ({
          ...testDocument,
          ID: [{ _: `INV-CONCURRENT-${i + 1}` }],
        }));

      const start = performance.now();

      const results = await Promise.all(
        documents.map(
          (doc) =>
            new Promise<unknown>((resolve) => {
              const result = sign(doc, privateKey, certPem, certInfo);
              resolve(result);
            })
        )
      );

      const duration = performance.now() - start;
      const avgPerDoc = duration / 10;

      expect(results).toHaveLength(10);
      expect(avgPerDoc).toBeLessThan(100); // Each doc should still be <100ms on average
      console.log(
        `10 concurrent documents: ${duration.toFixed(2)}ms total, ${avgPerDoc.toFixed(2)}ms avg per doc`
      );
    });
  });

  describe("batch signing", () => {
    it("signs 100 documents sequentially", () => {
      const iterations = 100;
      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const doc = {
          ...testDocument,
          ID: [{ _: `INV-BATCH-${i + 1}` }],
        };

        const start = performance.now();
        sign(doc, privateKey, certPem, certInfo);
        durations.push(performance.now() - start);
      }

      const total = durations.reduce((a, b) => a + b, 0);
      const avg = total / iterations;
      const min = Math.min(...durations);
      const max = Math.max(...durations);

      console.log(`100 sequential documents:`);
      console.log(`  Total: ${total.toFixed(2)}ms`);
      console.log(`  Average: ${avg.toFixed(2)}ms`);
      console.log(`  Min: ${min.toFixed(2)}ms`);
      console.log(`  Max: ${max.toFixed(2)}ms`);

      // Average should be under 100ms
      expect(avg).toBeLessThan(100);
    });
  });

  describe("memory usage", () => {
    it("maintains stable memory over 100 signing operations", () => {
      const iterations = 100;

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const initialHeap = process.memoryUsage().heapUsed;

      for (let i = 0; i < iterations; i++) {
        const doc = {
          ...testDocument,
          ID: [{ _: `INV-MEMORY-${i + 1}` }],
        };
        sign(doc, privateKey, certPem, certInfo);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalHeap = process.memoryUsage().heapUsed;
      const heapGrowth = finalHeap - initialHeap;
      const heapGrowthMB = heapGrowth / 1024 / 1024;

      console.log(`Memory usage after 100 operations:`);
      console.log(`  Initial heap: ${(initialHeap / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Final heap: ${(finalHeap / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Growth: ${heapGrowthMB.toFixed(2)}MB`);

      // Heap should not grow by more than 50MB for 100 operations
      expect(heapGrowthMB).toBeLessThan(50);
    });
  });
});
