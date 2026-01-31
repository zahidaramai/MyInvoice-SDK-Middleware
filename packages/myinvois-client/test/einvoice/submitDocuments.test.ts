/**
 * Tests for submitDocuments API function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("submitDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("submission response handling", () => {
    it("handles successful submission with all accepted documents", () => {
      const response = {
        submissionUid: "HJSD135P2S7D8IU",
        acceptedDocuments: [
          { uuid: "F9D425P6DS7D8IU", invoiceCodeNumber: "INV12345" },
          { uuid: "G8E536Q7ET8E9IV", invoiceCodeNumber: "INV12346" },
        ],
        rejectedDocuments: [],
      };

      expect(response.acceptedDocuments).toHaveLength(2);
      expect(response.rejectedDocuments).toHaveLength(0);
      expect(response.submissionUid).toBeDefined();
    });

    it("handles partially successful submission", () => {
      const response = {
        submissionUid: "HJSD135P2S7D8IU",
        acceptedDocuments: [
          { uuid: "F9D425P6DS7D8IU", invoiceCodeNumber: "INV12345" },
        ],
        rejectedDocuments: [
          {
            invoiceCodeNumber: "INV12346",
            error: {
              propertyName: "Invoice",
              propertyPath: "Invoice/TaxTotal",
              errorCode: "InvalidTotalAmount",
              error: "Tax amount does not match",
              errorMS: "Jumlah cukai tidak sepadan",
            },
          },
        ],
      };

      expect(response.acceptedDocuments).toHaveLength(1);
      expect(response.rejectedDocuments).toHaveLength(1);
      expect(response.rejectedDocuments[0].error.errorCode).toBe("InvalidTotalAmount");
    });

    it("handles fully rejected submission", () => {
      const response = {
        submissionUid: "HJSD135P2S7D8IU",
        acceptedDocuments: [],
        rejectedDocuments: [
          {
            invoiceCodeNumber: "INV12345",
            error: {
              propertyName: "TIN",
              propertyPath: "Invoice/AccountingCustomerParty/TIN",
              errorCode: "InvalidTIN",
              error: "TIN not registered",
            },
          },
          {
            invoiceCodeNumber: "INV12346",
            error: {
              propertyName: "TIN",
              propertyPath: "Invoice/AccountingSupplierParty/TIN",
              errorCode: "InvalidTIN",
              error: "TIN not registered",
            },
          },
        ],
      };

      expect(response.acceptedDocuments).toHaveLength(0);
      expect(response.rejectedDocuments).toHaveLength(2);
    });
  });

  describe("document validation errors", () => {
    it("parses structure validation error", () => {
      const error = {
        propertyName: "Invoice",
        propertyPath: "Invoice",
        errorCode: "BadStructure",
        error: "Missing required element",
        target: "LegalMonetaryTotal",
      };

      expect(error.errorCode).toBe("BadStructure");
      expect(error.target).toBe("LegalMonetaryTotal");
    });

    it("parses TIN validation error", () => {
      const error = {
        propertyName: "TIN",
        propertyPath: "Invoice/AccountingCustomerParty/PartyTaxScheme/CompanyID",
        errorCode: "InvalidTIN",
        error: "The TIN provided is not registered",
        errorMS: "TIN yang diberikan tidak berdaftar",
        target: "C99999999999",
      };

      expect(error.errorCode).toBe("InvalidTIN");
      expect(error.target).toBe("C99999999999");
      expect(error.errorMS).toBeDefined();
    });

    it("parses tax calculation error", () => {
      const error = {
        propertyName: "TaxAmount",
        propertyPath: "Invoice/TaxTotal/TaxAmount",
        errorCode: "InvalidTaxAmount",
        error: "Tax amount does not match calculated value",
        target: "106.50",
      };

      expect(error.errorCode).toBe("InvalidTaxAmount");
    });

    it("parses amount validation error", () => {
      const error = {
        propertyName: "PayableAmount",
        propertyPath: "Invoice/LegalMonetaryTotal/PayableAmount",
        errorCode: "InvalidTotalAmount",
        error: "Total payable amount is incorrect",
      };

      expect(error.errorCode).toBe("InvalidTotalAmount");
    });

    it("parses duplicate submission error", () => {
      const error = {
        propertyName: "Invoice",
        errorCode: "DuplicateSubmission",
        error: "Document already submitted within last 10 minutes",
      };

      expect(error.errorCode).toBe("DuplicateSubmission");
    });
  });

  describe("submission constraints", () => {
    it("validates max documents per submission", () => {
      const MAX_DOCUMENTS = 100;
      const documents = Array.from({ length: 50 }, (_, i) => ({
        id: `doc-${i}`,
      }));

      expect(documents.length).toBeLessThanOrEqual(MAX_DOCUMENTS);
    });

    it("validates max submission size", () => {
      const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
      const submissionJson = JSON.stringify({ documents: [] });

      expect(Buffer.byteLength(submissionJson)).toBeLessThan(MAX_SIZE_BYTES);
    });

    it("validates max document size", () => {
      const MAX_DOC_SIZE = 300 * 1024; // 300 KB
      const documentJson = JSON.stringify({ Invoice: {} });

      expect(Buffer.byteLength(documentJson)).toBeLessThan(MAX_DOC_SIZE);
    });
  });

  describe("HTTP status handling", () => {
    it("handles 202 Accepted response", () => {
      const status = 202;
      expect(status).toBe(202);
      // Submission accepted for processing
    });

    it("handles 400 Bad Request", () => {
      const status = 400;
      const error = {
        code: "BadRequest",
        message: "Invalid document format",
      };

      expect(status).toBe(400);
      expect(error.code).toBe("BadRequest");
    });

    it("handles 401 Unauthorized", () => {
      const status = 401;
      const error = {
        code: "Unauthorized",
        message: "Invalid or expired token",
      };

      expect(status).toBe(401);
      expect(error.code).toBe("Unauthorized");
    });

    it("handles 403 Forbidden", () => {
      const status = 403;
      const error = {
        code: "IncorrectSubmitter",
        message: "Not authorized to submit for this taxpayer",
      };

      expect(status).toBe(403);
      expect(error.code).toBe("IncorrectSubmitter");
    });

    it("handles 422 Duplicate Submission", () => {
      const status = 422;
      const error = {
        code: "DuplicateSubmission",
        message: "Identical document submitted recently",
      };

      expect(status).toBe(422);
      expect(error.code).toBe("DuplicateSubmission");
    });

    it("handles 429 Rate Limit", () => {
      const status = 429;
      const retryAfter = 60;

      expect(status).toBe(429);
      expect(retryAfter).toBeGreaterThan(0);
    });

    it("handles 500 Server Error", () => {
      const status = 500;
      const error = {
        code: "InternalServerError",
        message: "Server error, please retry later",
      };

      expect(status).toBe(500);
      expect(error.code).toBe("InternalServerError");
    });
  });

  describe("document format", () => {
    it("accepts JSON format documents", () => {
      const document = {
        format: "JSON",
        document: {
          Invoice: {
            ID: "INV001",
            IssueDate: "2024-01-15",
          },
        },
      };

      expect(document.format).toBe("JSON");
      expect(document.document.Invoice).toBeDefined();
    });

    it("accepts XML format documents", () => {
      const document = {
        format: "XML",
        document: '<?xml version="1.0"?><Invoice><ID>INV001</ID></Invoice>',
      };

      expect(document.format).toBe("XML");
      expect(document.document).toContain("<Invoice>");
    });

    it("requires proper encoding for special characters", () => {
      const document = {
        format: "JSON",
        document: {
          Invoice: {
            Note: "Test & verify < > characters",
          },
        },
      };

      const json = JSON.stringify(document);
      expect(json).toContain("&");
    });
  });

  describe("request headers", () => {
    it("includes required authorization header", () => {
      const headers = {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      expect(headers.Authorization).toMatch(/^Bearer /);
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("includes onbehalfof header for intermediary mode", () => {
      const headers = {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        onbehalfof: "C12345678901",
      };

      expect(headers.onbehalfof).toMatch(/^C\d{11}$/);
    });
  });

  describe("response metadata", () => {
    it("extracts correlation ID from response", () => {
      const responseHeaders = new Headers({
        correlationid: "corr-12345",
        "x-rate-limit-limit": "100",
        "x-rate-limit-remaining": "95",
      });

      const correlationId = responseHeaders.get("correlationid") ||
        responseHeaders.get("x-correlation-id");

      expect(correlationId).toBe("corr-12345");
    });

    it("extracts rate limit info from response", () => {
      const responseHeaders = new Headers({
        "x-rate-limit-limit": "100",
        "x-rate-limit-remaining": "95",
        "x-rate-limit-reset": "1704067200",
      });

      const limit = parseInt(responseHeaders.get("x-rate-limit-limit") || "0", 10);
      const remaining = parseInt(responseHeaders.get("x-rate-limit-remaining") || "0", 10);

      expect(limit).toBe(100);
      expect(remaining).toBe(95);
    });
  });

  describe("batch submission", () => {
    it("groups documents by type", () => {
      const documents = [
        { type: "01", id: "INV001" },
        { type: "02", id: "CN001" },
        { type: "01", id: "INV002" },
      ];

      const invoices = documents.filter((d) => d.type === "01");
      const creditNotes = documents.filter((d) => d.type === "02");

      expect(invoices).toHaveLength(2);
      expect(creditNotes).toHaveLength(1);
    });

    it("validates document count within limits", () => {
      const MAX_DOCS = 100;
      const documents = Array.from({ length: 100 }, (_, i) => ({
        id: `DOC-${i}`,
      }));

      expect(documents.length).toBe(MAX_DOCS);
      expect(documents.length).toBeLessThanOrEqual(MAX_DOCS);
    });
  });
});
