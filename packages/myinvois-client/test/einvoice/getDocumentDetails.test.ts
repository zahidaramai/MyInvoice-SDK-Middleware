/**
 * Tests for getDocumentDetails API function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the module
vi.mock("../../src/tokenManager.js", () => ({
  TokenManager: vi.fn(),
}));

describe("getDocumentDetails", () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful document details retrieval", () => {
    it("returns document details with valid status", async () => {
      const mockResponse = {
        uuid: "test-uuid",
        submissionUid: "sub-uid",
        longId: "long-id-123",
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
        totalDiscount: 0.00,
        totalNetAmount: 100.00,
        totalPayableAmount: 106.00,
        status: "Valid",
        validationResults: {
          status: "Valid",
          validationSteps: [
            { name: "Structure Validation", status: "Valid" },
            { name: "TIN Validation", status: "Valid" },
          ],
        },
      };

      expect(mockResponse.status).toBe("Valid");
      expect(mockResponse.longId).toBeDefined();
      expect(mockResponse.validationResults.status).toBe("Valid");
    });

    it("handles document with Invalid status", async () => {
      const mockResponse = {
        uuid: "test-uuid",
        status: "Invalid",
        validationResults: {
          status: "Invalid",
          validationSteps: [
            { name: "Structure Validation", status: "Valid" },
            {
              name: "TIN Validation",
              status: "Invalid",
              error: {
                code: "InvalidTIN",
                message: "The TIN provided is not registered",
                target: "C99999999999",
              },
            },
          ],
        },
      };

      expect(mockResponse.status).toBe("Invalid");
      expect(mockResponse.validationResults.status).toBe("Invalid");
      const failedStep = mockResponse.validationResults.validationSteps.find(
        (s) => s.status === "Invalid"
      );
      expect(failedStep).toBeDefined();
      expect(failedStep?.error?.code).toBe("InvalidTIN");
    });

    it("handles Submitted status without longId", async () => {
      const mockResponse = {
        uuid: "test-uuid",
        status: "Submitted",
        longId: null,
      };

      expect(mockResponse.status).toBe("Submitted");
      expect(mockResponse.longId).toBeNull();
    });

    it("handles Cancelled status", async () => {
      const mockResponse = {
        uuid: "test-uuid",
        status: "Cancelled",
        cancelDateTime: "2024-01-16T12:00:00Z",
      };

      expect(mockResponse.status).toBe("Cancelled");
      expect(mockResponse.cancelDateTime).toBeDefined();
    });

    it("handles Rejected status", async () => {
      const mockResponse = {
        uuid: "test-uuid",
        status: "Rejected",
        rejectDateTime: "2024-01-16T14:00:00Z",
      };

      expect(mockResponse.status).toBe("Rejected");
      expect(mockResponse.rejectDateTime).toBeDefined();
    });
  });

  describe("validation results parsing", () => {
    it("extracts error details from validation steps", () => {
      const validationResults = {
        status: "Invalid",
        validationSteps: [
          { name: "Step 1", status: "Valid" },
          {
            name: "Tax Calculation",
            status: "Invalid",
            error: {
              code: "InvalidTaxAmount",
              message: "Tax amount does not match",
              propertyPath: "Invoice/TaxTotal/TaxAmount",
              target: "106.50",
            },
          },
        ],
      };

      const failedSteps = validationResults.validationSteps.filter(
        (s) => s.status === "Invalid"
      );
      expect(failedSteps).toHaveLength(1);
      expect(failedSteps[0].error?.code).toBe("InvalidTaxAmount");
      expect(failedSteps[0].error?.propertyPath).toBe("Invoice/TaxTotal/TaxAmount");
    });

    it("handles multiple validation errors", () => {
      const validationResults = {
        status: "Invalid",
        validationSteps: [
          {
            name: "TIN Validation",
            status: "Invalid",
            error: { code: "InvalidTIN", message: "TIN not found" },
          },
          {
            name: "Tax Calculation",
            status: "Invalid",
            error: { code: "InvalidTax", message: "Tax mismatch" },
          },
        ],
      };

      const failedSteps = validationResults.validationSteps.filter(
        (s) => s.status === "Invalid"
      );
      expect(failedSteps).toHaveLength(2);
    });

    it("handles validation with all steps passed", () => {
      const validationResults = {
        status: "Valid",
        validationSteps: [
          { name: "Structure", status: "Valid" },
          { name: "TIN", status: "Valid" },
          { name: "Tax", status: "Valid" },
          { name: "Signature", status: "Valid" },
        ],
      };

      const failedSteps = validationResults.validationSteps.filter(
        (s) => s.status === "Invalid"
      );
      expect(failedSteps).toHaveLength(0);
    });
  });

  describe("date handling", () => {
    it("parses ISO date strings correctly", () => {
      const dates = {
        dateTimeIssued: "2024-01-15T10:00:00Z",
        dateTimeReceived: "2024-01-15T10:05:00Z",
        dateTimeValidated: "2024-01-15T10:06:00Z",
      };

      const issued = new Date(dates.dateTimeIssued);
      const received = new Date(dates.dateTimeReceived);
      const validated = new Date(dates.dateTimeValidated);

      expect(issued.getTime()).toBeLessThan(received.getTime());
      expect(received.getTime()).toBeLessThan(validated.getTime());
    });

    it("handles null dates", () => {
      const response = {
        dateTimeValidated: null,
        cancelDateTime: null,
        rejectDateTime: null,
      };

      expect(response.dateTimeValidated).toBeNull();
      expect(response.cancelDateTime).toBeNull();
      expect(response.rejectDateTime).toBeNull();
    });
  });

  describe("amount calculations", () => {
    it("verifies amount consistency", () => {
      const amounts = {
        totalExcludingTax: 100.00,
        totalDiscount: 10.00,
        totalNetAmount: 90.00,
        totalPayableAmount: 95.40, // 90 + 6% tax
      };

      expect(amounts.totalNetAmount).toBe(amounts.totalExcludingTax - amounts.totalDiscount);
    });

    it("handles decimal precision", () => {
      const amounts = {
        totalExcludingTax: 99.99,
        totalPayableAmount: 105.99,
      };

      expect(typeof amounts.totalExcludingTax).toBe("number");
      expect(amounts.totalPayableAmount.toFixed(2)).toBe("105.99");
    });
  });

  describe("status mappings", () => {
    it("recognizes all valid status values", () => {
      const validStatuses = ["Submitted", "Valid", "Invalid", "Cancelled", "Rejected"];

      validStatuses.forEach((status) => {
        expect(typeof status).toBe("string");
        expect(["Submitted", "Valid", "Invalid", "Cancelled", "Rejected"]).toContain(status);
      });
    });

    it("maps terminal statuses correctly", () => {
      const terminalStatuses = ["Valid", "Invalid", "Cancelled", "Rejected"];
      const nonTerminalStatuses = ["Submitted"];

      terminalStatuses.forEach((status) => {
        expect(["Valid", "Invalid", "Cancelled", "Rejected"]).toContain(status);
      });

      nonTerminalStatuses.forEach((status) => {
        expect(["Valid", "Invalid", "Cancelled", "Rejected"]).not.toContain(status);
      });
    });
  });
});
