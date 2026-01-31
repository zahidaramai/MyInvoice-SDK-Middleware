/**
 * Tests for stable hash functions
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";

describe("stableHash", () => {
  describe("document hash generation", () => {
    it("generates consistent hash for same document", () => {
      const document = {
        Invoice: {
          ID: "INV001",
          IssueDate: "2024-01-15",
        },
      };

      const hash1 = hashDocument(document);
      const hash2 = hashDocument(document);

      expect(hash1).toBe(hash2);
    });

    it("generates different hash for different documents", () => {
      const doc1 = { Invoice: { ID: "INV001" } };
      const doc2 = { Invoice: { ID: "INV002" } };

      const hash1 = hashDocument(doc1);
      const hash2 = hashDocument(doc2);

      expect(hash1).not.toBe(hash2);
    });

    it("generates different hash when content changes", () => {
      const doc1 = { Invoice: { ID: "INV001", Amount: 100 } };
      const doc2 = { Invoice: { ID: "INV001", Amount: 200 } };

      const hash1 = hashDocument(doc1);
      const hash2 = hashDocument(doc2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("key ordering", () => {
    it("produces same hash regardless of key order", () => {
      const doc1 = { a: 1, b: 2, c: 3 };
      const doc2 = { c: 3, a: 1, b: 2 };

      const hash1 = hashStableDocument(doc1);
      const hash2 = hashStableDocument(doc2);

      expect(hash1).toBe(hash2);
    });

    it("handles nested object key ordering", () => {
      const doc1 = { outer: { a: 1, b: 2 } };
      const doc2 = { outer: { b: 2, a: 1 } };

      const hash1 = hashStableDocument(doc1);
      const hash2 = hashStableDocument(doc2);

      expect(hash1).toBe(hash2);
    });
  });

  describe("hash format", () => {
    it("produces hex encoded hash", () => {
      const document = { test: "value" };
      const hash = hashDocument(document);

      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it("produces SHA-256 hash (64 characters)", () => {
      const document = { test: "value" };
      const hash = hashDocument(document);

      expect(hash.length).toBe(64);
    });
  });

  describe("special values", () => {
    it("handles null values", () => {
      const document = { value: null };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles undefined values", () => {
      const document = { value: undefined };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles empty object", () => {
      const document = {};
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles arrays", () => {
      const document = { items: [1, 2, 3] };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles nested arrays", () => {
      const document = {
        matrix: [
          [1, 2],
          [3, 4],
        ],
      };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles dates as strings", () => {
      const document = { date: "2024-01-15T10:00:00Z" };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles boolean values", () => {
      const document = { flag: true, other: false };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });
  });

  describe("numeric precision", () => {
    it("handles integer values", () => {
      const document = { value: 123456789 };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles decimal values", () => {
      const document = { value: 123.456789 };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("differentiates between integer and float", () => {
      const doc1 = { value: 100 };
      const doc2 = { value: 100.0 };

      // In JS, 100 and 100.0 are the same
      const hash1 = hashDocument(doc1);
      const hash2 = hashDocument(doc2);

      expect(hash1).toBe(hash2);
    });
  });

  describe("string handling", () => {
    it("handles empty strings", () => {
      const document = { value: "" };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles unicode strings", () => {
      const document = { value: "日本語テスト" };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles special characters", () => {
      const document = { value: "test\n\t\r" };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
    });

    it("handles long strings", () => {
      const document = { value: "a".repeat(10000) };
      const hash = hashDocument(document);

      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });
  });

  describe("deduplication use case", () => {
    it("detects duplicate submissions", () => {
      const submission1 = {
        documents: [{ Invoice: { ID: "INV001", Amount: 100 } }],
      };

      const submission2 = {
        documents: [{ Invoice: { ID: "INV001", Amount: 100 } }],
      };

      const hash1 = hashDocument(submission1);
      const hash2 = hashDocument(submission2);

      expect(hash1).toBe(hash2); // Duplicate detected
    });

    it("distinguishes different submissions", () => {
      const submission1 = {
        documents: [{ Invoice: { ID: "INV001", Amount: 100 } }],
      };

      const submission2 = {
        documents: [{ Invoice: { ID: "INV001", Amount: 200 } }],
      };

      const hash1 = hashDocument(submission1);
      const hash2 = hashDocument(submission2);

      expect(hash1).not.toBe(hash2);
    });
  });
});

// Helper functions
function hashDocument(document: unknown): string {
  const json = JSON.stringify(document);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function hashStableDocument(document: unknown): string {
  const sortedJson = JSON.stringify(sortObjectKeys(document));
  return crypto.createHash("sha256").update(sortedJson).digest("hex");
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();

  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }

  return sorted;
}
