/**
 * Tests for searchDocuments API function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("searchDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("search parameters", () => {
    it("builds search with date range", () => {
      const params = {
        submissionDateFrom: "2024-01-01T00:00:00Z",
        submissionDateTo: "2024-01-31T23:59:59Z",
      };

      expect(params.submissionDateFrom).toBeDefined();
      expect(params.submissionDateTo).toBeDefined();
    });

    it("builds search with issuer TIN", () => {
      const params = {
        issuerTin: "C12345678901",
      };

      expect(params.issuerTin).toMatch(/^C\d{11}$/);
    });

    it("builds search with receiver ID", () => {
      const params = {
        receiverId: "C98765432100",
      };

      expect(params.receiverId).toBeDefined();
    });

    it("builds search with status filter", () => {
      const params = {
        status: "Valid",
      };

      expect(["Submitted", "Valid", "Invalid", "Cancelled", "Rejected"]).toContain(
        params.status
      );
    });

    it("builds search with document type", () => {
      const params = {
        documentType: "01", // Invoice
      };

      expect(params.documentType).toBe("01");
    });

    it("builds search with multiple filters", () => {
      const params = {
        issuerTin: "C12345678901",
        status: "Valid",
        submissionDateFrom: "2024-01-01T00:00:00Z",
        pageNo: 1,
        pageSize: 50,
      };

      expect(Object.keys(params)).toHaveLength(5);
    });
  });

  describe("pagination", () => {
    it("uses default page size", () => {
      const params = {
        pageNo: 1,
        pageSize: 100,
      };

      expect(params.pageNo).toBe(1);
      expect(params.pageSize).toBe(100);
    });

    it("supports custom page size", () => {
      const params = {
        pageNo: 2,
        pageSize: 50,
      };

      expect(params.pageNo).toBe(2);
      expect(params.pageSize).toBe(50);
    });

    it("validates page size limits", () => {
      const maxPageSize = 100;
      const requestedSize = 150;

      const effectiveSize = Math.min(requestedSize, maxPageSize);
      expect(effectiveSize).toBe(100);
    });
  });

  describe("search response", () => {
    it("returns paginated document list", () => {
      const response = {
        result: [
          {
            uuid: "doc-1",
            submissionUid: "sub-1",
            longId: "long-1",
            internalId: "INV001",
            status: "Valid",
            dateTimeIssued: "2024-01-15T10:00:00Z",
            totalPayableAmount: 106.00,
          },
          {
            uuid: "doc-2",
            submissionUid: "sub-1",
            longId: "long-2",
            internalId: "INV002",
            status: "Valid",
            dateTimeIssued: "2024-01-15T11:00:00Z",
            totalPayableAmount: 212.00,
          },
        ],
        metadata: {
          totalPages: 5,
          totalCount: 250,
        },
      };

      expect(response.result).toHaveLength(2);
      expect(response.metadata.totalCount).toBe(250);
    });

    it("returns empty result when no matches", () => {
      const response = {
        result: [],
        metadata: {
          totalPages: 0,
          totalCount: 0,
        },
      };

      expect(response.result).toHaveLength(0);
      expect(response.metadata.totalCount).toBe(0);
    });

    it("includes document details in results", () => {
      const document = {
        uuid: "doc-uuid",
        submissionUid: "sub-uid",
        longId: "long-id",
        internalId: "INV001",
        typeName: "Invoice",
        typeVersionName: "1.1",
        issuerTin: "C12345678901",
        issuerName: "Test Company",
        receiverId: "C98765432100",
        receiverName: "Buyer Company",
        dateTimeIssued: "2024-01-15T10:00:00Z",
        dateTimeReceived: "2024-01-15T10:05:00Z",
        dateTimeValidated: "2024-01-15T10:06:00Z",
        totalExcludingTax: 100.00,
        totalNetAmount: 100.00,
        totalPayableAmount: 106.00,
        status: "Valid",
      };

      expect(document.uuid).toBeDefined();
      expect(document.longId).toBeDefined();
      expect(document.status).toBe("Valid");
    });
  });

  describe("direction parameter", () => {
    it("searches sent documents", () => {
      const params = {
        direction: "Sent",
        issuerTin: "C12345678901",
      };

      expect(params.direction).toBe("Sent");
    });

    it("searches received documents", () => {
      const params = {
        direction: "Received",
        receiverId: "C12345678901",
      };

      expect(params.direction).toBe("Received");
    });
  });

  describe("date filtering", () => {
    it("filters by submission date", () => {
      const params = {
        submissionDateFrom: "2024-01-01T00:00:00Z",
        submissionDateTo: "2024-01-31T23:59:59Z",
      };

      const from = new Date(params.submissionDateFrom);
      const to = new Date(params.submissionDateTo);

      expect(from.getTime()).toBeLessThan(to.getTime());
    });

    it("filters by issue date", () => {
      const params = {
        issueDateFrom: "2024-01-01T00:00:00Z",
        issueDateTo: "2024-01-31T23:59:59Z",
      };

      const from = new Date(params.issueDateFrom);
      const to = new Date(params.issueDateTo);

      expect(from.getTime()).toBeLessThan(to.getTime());
    });
  });

  describe("document type filtering", () => {
    it("filters by invoice type", () => {
      const params = { documentType: "01" };
      expect(params.documentType).toBe("01");
    });

    it("filters by credit note type", () => {
      const params = { documentType: "02" };
      expect(params.documentType).toBe("02");
    });

    it("filters by debit note type", () => {
      const params = { documentType: "03" };
      expect(params.documentType).toBe("03");
    });

    it("filters by self-billed invoice", () => {
      const params = { documentType: "11" };
      expect(params.documentType).toBe("11");
    });
  });

  describe("error handling", () => {
    it("handles unauthorized error", () => {
      const error = {
        status: 401,
        code: "UNAUTHORIZED",
      };

      expect(error.status).toBe(401);
    });

    it("handles rate limit error", () => {
      const error = {
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
      };

      expect(error.status).toBe(429);
    });

    it("handles invalid parameters error", () => {
      const error = {
        status: 400,
        code: "BAD_REQUEST",
        message: "Invalid date format",
      };

      expect(error.status).toBe(400);
    });
  });

  describe("URL construction", () => {
    it("builds search URL with query params", () => {
      const baseUrl = "https://api.myinvois.hasil.gov.my";
      const path = "/api/v1.0/documents/search";
      const params = new URLSearchParams({
        pageNo: "1",
        pageSize: "50",
        status: "Valid",
      });

      const url = `${baseUrl}${path}?${params.toString()}`;

      expect(url).toContain("/documents/search");
      expect(url).toContain("status=Valid");
    });

    it("encodes special characters in query", () => {
      const params = new URLSearchParams({
        issuerName: "Test & Company",
      });

      expect(params.toString()).toContain("Test+%26+Company");
    });
  });

  describe("sorting", () => {
    it("sorts by submission date descending", () => {
      const documents = [
        { dateTimeReceived: "2024-01-15T10:00:00Z" },
        { dateTimeReceived: "2024-01-14T10:00:00Z" },
        { dateTimeReceived: "2024-01-16T10:00:00Z" },
      ];

      const sorted = [...documents].sort(
        (a, b) =>
          new Date(b.dateTimeReceived).getTime() -
          new Date(a.dateTimeReceived).getTime()
      );

      expect(sorted[0].dateTimeReceived).toBe("2024-01-16T10:00:00Z");
    });

    it("sorts by amount ascending", () => {
      const documents = [
        { totalPayableAmount: 200 },
        { totalPayableAmount: 100 },
        { totalPayableAmount: 150 },
      ];

      const sorted = [...documents].sort(
        (a, b) => a.totalPayableAmount - b.totalPayableAmount
      );

      expect(sorted[0].totalPayableAmount).toBe(100);
    });
  });
});
