import { describe, it, expect } from "vitest";
import {
  estimateBase64DecodedSize,
  encodeBase64,
  hashDocument,
  prepareDocument,
  validateSubmissionConstraints,
  computePayloadHash,
  generateTrackingId,
  isValidTrackingId,
  SUBMISSION_CONSTRAINTS,
  type PreparedDocument,
} from "./submission.js";

describe("estimateBase64DecodedSize", () => {
  it("estimates decoded size correctly", () => {
    // Base64 encoding increases size by ~33%
    // 1000 base64 chars = ~750 bytes decoded
    expect(estimateBase64DecodedSize(1000)).toBe(750);
    expect(estimateBase64DecodedSize(4)).toBe(3);
    expect(estimateBase64DecodedSize(100)).toBe(75);
  });

  it("handles zero length", () => {
    expect(estimateBase64DecodedSize(0)).toBe(0);
  });
});

describe("encodeBase64", () => {
  it("encodes string to base64", () => {
    expect(encodeBase64("hello")).toBe("aGVsbG8=");
    expect(encodeBase64("test")).toBe("dGVzdA==");
  });

  it("handles empty string", () => {
    expect(encodeBase64("")).toBe("");
  });

  it("handles unicode", () => {
    const encoded = encodeBase64("你好");
    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe("你好");
  });
});

describe("hashDocument", () => {
  it("produces consistent SHA256 hash", () => {
    const hash1 = hashDocument("test");
    const hash2 = hashDocument("test");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA256 hex length
  });

  it("produces different hashes for different content", () => {
    const hash1 = hashDocument("test1");
    const hash2 = hashDocument("test2");
    expect(hash1).not.toBe(hash2);
  });
});

describe("prepareDocument", () => {
  it("prepares document from rawDocument", () => {
    const input = {
      format: "XML" as const,
      codeNumber: "INV-001",
      rawDocument: "<invoice>test</invoice>",
    };

    const result = prepareDocument(input);

    expect(result.format).toBe("XML");
    expect(result.codeNumber).toBe("INV-001");
    expect(result.document).toBe(encodeBase64(input.rawDocument));
    expect(result.documentHash).toBe(hashDocument(input.rawDocument));
    expect(result.estimatedSizeBytes).toBe(
      Buffer.byteLength(input.rawDocument, "utf-8")
    );
  });

  it("prepares document from pre-encoded base64", () => {
    const base64 = "dGVzdA=="; // "test" in base64
    const input = {
      format: "JSON" as const,
      codeNumber: "INV-002",
      documentBase64: base64,
      documentHashSha256: "abc123",
    };

    const result = prepareDocument(input);

    expect(result.format).toBe("JSON");
    expect(result.codeNumber).toBe("INV-002");
    expect(result.document).toBe(base64);
    expect(result.documentHash).toBe("abc123");
    expect(result.estimatedSizeBytes).toBe(estimateBase64DecodedSize(base64.length));
  });

  it("throws if neither rawDocument nor documentBase64 provided", () => {
    expect(() =>
      prepareDocument({
        format: "XML",
        codeNumber: "INV-003",
      })
    ).toThrow("Either rawDocument or documentBase64 must be provided");
  });
});

describe("validateSubmissionConstraints", () => {
  const createDoc = (sizeBytes: number): PreparedDocument => ({
    format: "XML",
    codeNumber: `INV-${Math.random()}`,
    document: "base64data",
    documentHash: "hash",
    estimatedSizeBytes: sizeBytes,
  });

  it("passes valid submission", () => {
    const docs = [createDoc(1000), createDoc(2000)];
    const errors = validateSubmissionConstraints(docs);
    expect(errors).toHaveLength(0);
  });

  it("rejects empty documents array", () => {
    const errors = validateSubmissionConstraints([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("NO_DOCUMENTS");
  });

  it("rejects too many documents", () => {
    const docs = Array.from({ length: 101 }, () => createDoc(1000));
    const errors = validateSubmissionConstraints(docs);
    expect(errors.some((e) => e.code === "TOO_MANY_DOCUMENTS")).toBe(true);
  });

  it("rejects document exceeding max size", () => {
    const oversizedDoc = createDoc(SUBMISSION_CONSTRAINTS.MAX_DOCUMENT_SIZE_BYTES + 1);
    const errors = validateSubmissionConstraints([oversizedDoc]);
    expect(errors.some((e) => e.code === "DOCUMENT_TOO_LARGE")).toBe(true);
  });

  it("rejects submission exceeding total size", () => {
    // Create 10 docs of 600KB each = 6MB > 5MB limit
    const docs = Array.from({ length: 10 }, () => createDoc(600 * 1024));
    const errors = validateSubmissionConstraints(docs);
    expect(errors.some((e) => e.code === "SUBMISSION_TOO_LARGE")).toBe(true);
  });
});

describe("computePayloadHash", () => {
  it("produces consistent hash for same documents", () => {
    const docs: PreparedDocument[] = [
      {
        format: "XML",
        codeNumber: "INV-001",
        document: "doc1",
        documentHash: "hash1",
        estimatedSizeBytes: 100,
      },
      {
        format: "JSON",
        codeNumber: "INV-002",
        document: "doc2",
        documentHash: "hash2",
        estimatedSizeBytes: 200,
      },
    ];

    const hash1 = computePayloadHash(docs);
    const hash2 = computePayloadHash(docs);
    expect(hash1).toBe(hash2);
  });

  it("produces same hash regardless of document order", () => {
    const doc1: PreparedDocument = {
      format: "XML",
      codeNumber: "INV-001",
      document: "doc1",
      documentHash: "hash1",
      estimatedSizeBytes: 100,
    };
    const doc2: PreparedDocument = {
      format: "JSON",
      codeNumber: "INV-002",
      document: "doc2",
      documentHash: "hash2",
      estimatedSizeBytes: 200,
    };

    const hash1 = computePayloadHash([doc1, doc2]);
    const hash2 = computePayloadHash([doc2, doc1]);
    expect(hash1).toBe(hash2);
  });

  it("produces different hash for different documents", () => {
    const docs1: PreparedDocument[] = [
      {
        format: "XML",
        codeNumber: "INV-001",
        document: "doc1",
        documentHash: "hash1",
        estimatedSizeBytes: 100,
      },
    ];
    const docs2: PreparedDocument[] = [
      {
        format: "XML",
        codeNumber: "INV-001",
        document: "doc1",
        documentHash: "hash2", // Different hash
        estimatedSizeBytes: 100,
      },
    ];

    const hash1 = computePayloadHash(docs1);
    const hash2 = computePayloadHash(docs2);
    expect(hash1).not.toBe(hash2);
  });
});

describe("generateTrackingId", () => {
  it("generates valid tracking ID", () => {
    const id = generateTrackingId();
    expect(id).toMatch(/^trk_[a-zA-Z0-9]+$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateTrackingId());
    }
    expect(ids.size).toBe(100);
  });
});

describe("isValidTrackingId", () => {
  it("validates correct tracking ID format", () => {
    expect(isValidTrackingId("trk_abc123")).toBe(true);
    expect(isValidTrackingId("trk_ABC123xyz")).toBe(true);
    expect(isValidTrackingId("trk_a")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isValidTrackingId("trk_")).toBe(false);
    expect(isValidTrackingId("track_abc")).toBe(false);
    expect(isValidTrackingId("abc123")).toBe(false);
    expect(isValidTrackingId("TRK_abc")).toBe(false);
    expect(isValidTrackingId("trk-abc")).toBe(false);
    expect(isValidTrackingId("")).toBe(false);
  });
});
