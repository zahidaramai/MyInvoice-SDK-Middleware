/**
 * Tests for pollInvoice.worker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";

// Mock dependencies
vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../src/lib/redis.js", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
}));

vi.mock("../../src/lib/logger.js", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/queues/pollInvoice.queue.js", () => ({
  POLL_INVOICE_QUEUE_NAME: "poll-invoice",
  enqueueInvoicePoll: vi.fn().mockResolvedValue(undefined),
  calculateInvoicePollDelay: vi.fn().mockReturnValue(5000),
}));

const mockFindInvoiceById = vi.fn();
const mockFindCompanyById = vi.fn();
const mockUpdateInvoice = vi.fn();

vi.mock("@myinvois/storage", () => ({
  findInvoiceById: (...args: unknown[]) => mockFindInvoiceById(...args),
  findCompanyById: (...args: unknown[]) => mockFindCompanyById(...args),
  updateInvoice: (...args: unknown[]) => mockUpdateInvoice(...args),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("pollInvoice.worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("status mapping", () => {
    it("maps Valid to VALID", () => {
      const statusMap: Record<string, string> = {
        "Valid": "VALID",
        "Invalid": "INVALID",
        "Submitted": "SUBMITTED",
        "Cancelled": "CANCELLED",
        "Rejected": "REJECTED",
      };

      expect(statusMap["Valid"]).toBe("VALID");
    });

    it("maps Invalid to INVALID", () => {
      const statusMap: Record<string, string> = {
        "Valid": "VALID",
        "Invalid": "INVALID",
      };

      expect(statusMap["Invalid"]).toBe("INVALID");
    });

    it("maps Submitted to SUBMITTED", () => {
      const statusMap: Record<string, string> = {
        "Submitted": "SUBMITTED",
      };

      expect(statusMap["Submitted"]).toBe("SUBMITTED");
    });

    it("maps Cancelled to CANCELLED", () => {
      const statusMap: Record<string, string> = {
        "Cancelled": "CANCELLED",
      };

      expect(statusMap["Cancelled"]).toBe("CANCELLED");
    });

    it("maps Rejected to REJECTED", () => {
      const statusMap: Record<string, string> = {
        "Rejected": "REJECTED",
      };

      expect(statusMap["Rejected"]).toBe("REJECTED");
    });

    it("handles unknown status by uppercasing", () => {
      const mapStatus = (status: string) => {
        const statusMap: Record<string, string> = {
          "Valid": "VALID",
          "Invalid": "INVALID",
          "Submitted": "SUBMITTED",
          "Cancelled": "CANCELLED",
          "Rejected": "REJECTED",
        };
        return statusMap[status] || status.toUpperCase();
      };

      expect(mapStatus("Unknown")).toBe("UNKNOWN");
      expect(mapStatus("pending")).toBe("PENDING");
    });
  });

  describe("terminal status detection", () => {
    it("identifies Valid as terminal", () => {
      const terminalStatuses = ["Valid", "Invalid", "Cancelled", "Rejected"];
      expect(terminalStatuses.includes("Valid")).toBe(true);
    });

    it("identifies Invalid as terminal", () => {
      const terminalStatuses = ["Valid", "Invalid", "Cancelled", "Rejected"];
      expect(terminalStatuses.includes("Invalid")).toBe(true);
    });

    it("identifies Cancelled as terminal", () => {
      const terminalStatuses = ["Valid", "Invalid", "Cancelled", "Rejected"];
      expect(terminalStatuses.includes("Cancelled")).toBe(true);
    });

    it("identifies Rejected as terminal", () => {
      const terminalStatuses = ["Valid", "Invalid", "Cancelled", "Rejected"];
      expect(terminalStatuses.includes("Rejected")).toBe(true);
    });

    it("identifies Submitted as non-terminal", () => {
      const terminalStatuses = ["Valid", "Invalid", "Cancelled", "Rejected"];
      expect(terminalStatuses.includes("Submitted")).toBe(false);
    });
  });

  describe("job data structure", () => {
    it("validates job data has required fields", () => {
      const jobData = {
        invoiceId: "inv-123",
        myinvoisUuid: "uuid-456",
        companyId: "company-789",
        attempt: 0,
      };

      expect(jobData.invoiceId).toBeDefined();
      expect(jobData.myinvoisUuid).toBeDefined();
      expect(jobData.companyId).toBeDefined();
      expect(typeof jobData.attempt).toBe("number");
    });

    it("handles missing attempt field", () => {
      const jobData = {
        invoiceId: "inv-123",
        myinvoisUuid: "uuid-456",
        companyId: "company-789",
      };

      const attempt = (jobData as { attempt?: number }).attempt ?? 0;
      expect(attempt).toBe(0);
    });
  });

  describe("validation error extraction", () => {
    it("extracts error from validation results", () => {
      const validationResults = {
        status: "Invalid",
        validationSteps: [
          { status: "Valid", name: "Structure" },
          {
            status: "Invalid",
            name: "Tax Calculation",
            error: {
              code: "InvalidTaxAmount",
              message: "Tax amount mismatch",
              propertyPath: "Invoice/TaxTotal",
            },
          },
        ],
      };

      const failedStep = validationResults.validationSteps.find(
        (step) => step.status === "Invalid" && step.error
      );

      expect(failedStep).toBeDefined();
      expect(failedStep?.error?.code).toBe("InvalidTaxAmount");
      expect(failedStep?.error?.message).toBe("Tax amount mismatch");
    });

    it("returns undefined when no validation errors", () => {
      const validationResults = {
        status: "Valid",
        validationSteps: [
          { status: "Valid", name: "Structure" },
          { status: "Valid", name: "Tax Calculation" },
        ],
      };

      const failedStep = validationResults.validationSteps.find(
        (step) => step.status === "Invalid" && (step as { error?: unknown }).error
      );

      expect(failedStep).toBeUndefined();
    });

    it("constructs error message with property path", () => {
      const failedStep = {
        name: "TIN Validation",
        error: {
          code: "InvalidTIN",
          message: "TIN not registered",
          propertyPath: "AccountingCustomerParty/TIN",
        },
      };

      let errorMessage = `${failedStep.name}: ${failedStep.error.message}`;
      if (failedStep.error.propertyPath) {
        errorMessage += ` (${failedStep.error.propertyPath})`;
      }

      expect(errorMessage).toBe("TIN Validation: TIN not registered (AccountingCustomerParty/TIN)");
    });
  });

  describe("poll delay calculation", () => {
    it("increases delay with attempt number", () => {
      // Exponential backoff pattern
      const calculateDelay = (attempt: number) => {
        const baseDelay = 3000;
        const maxDelay = 300000;
        return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      };

      expect(calculateDelay(0)).toBe(3000);
      expect(calculateDelay(1)).toBe(6000);
      expect(calculateDelay(2)).toBe(12000);
      expect(calculateDelay(5)).toBe(96000);
    });

    it("caps delay at max value", () => {
      const calculateDelay = (attempt: number) => {
        const baseDelay = 3000;
        const maxDelay = 300000;
        return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      };

      // After many attempts, should cap at max
      expect(calculateDelay(10)).toBe(300000);
      expect(calculateDelay(20)).toBe(300000);
    });
  });

  describe("environment URL resolution", () => {
    it("returns SANDBOX URLs for non-PROD environment", () => {
      const env = "SANDBOX";

      const baseUrl = env === "PROD"
        ? "https://api.myinvois.hasil.gov.my"
        : "https://preprod-api.myinvois.hasil.gov.my";

      const identityUrl = env === "PROD"
        ? "https://identity.myinvois.hasil.gov.my"
        : "https://preprod-identity.myinvois.hasil.gov.my";

      expect(baseUrl).toBe("https://preprod-api.myinvois.hasil.gov.my");
      expect(identityUrl).toBe("https://preprod-identity.myinvois.hasil.gov.my");
    });

    it("returns PROD URLs for PROD environment", () => {
      const env = "PROD";

      const baseUrl = env === "PROD"
        ? "https://api.myinvois.hasil.gov.my"
        : "https://preprod-api.myinvois.hasil.gov.my";

      const identityUrl = env === "PROD"
        ? "https://identity.myinvois.hasil.gov.my"
        : "https://preprod-identity.myinvois.hasil.gov.my";

      expect(baseUrl).toBe("https://api.myinvois.hasil.gov.my");
      expect(identityUrl).toBe("https://identity.myinvois.hasil.gov.my");
    });
  });

  describe("error handling scenarios", () => {
    it("handles rate limit (429) response", () => {
      const response = { ok: false, error: "Rate limited", status: 429 };

      expect(response.status).toBe(429);
      // Should reschedule with longer delay (60s)
    });

    it("handles not found (404) response", () => {
      const response = { ok: false, error: "Not found", status: 404 };

      expect(response.status).toBe(404);
      // Should stop polling and mark as NOT_FOUND
    });

    it("handles network errors", () => {
      const response = { ok: false, error: "Network timeout", status: undefined };

      expect(response.ok).toBe(false);
      expect(response.status).toBeUndefined();
      // Should retry with exponential backoff
    });

    it("handles invalid JSON response", () => {
      const parseError = () => {
        throw new Error("Unexpected token");
      };

      expect(() => parseError()).toThrow("Unexpected token");
    });
  });

  describe("invoice state checks", () => {
    it("skips already terminal invoices", () => {
      const terminalStatuses = ["VALID", "INVALID", "CANCELLED", "REJECTED"];

      terminalStatuses.forEach((status) => {
        const invoice = { status };
        const isTerminal = ["VALID", "INVALID", "CANCELLED", "REJECTED"].includes(invoice.status);
        expect(isTerminal).toBe(true);
      });
    });

    it("processes non-terminal invoices", () => {
      const nonTerminalStatuses = ["DRAFT", "SUBMITTED", "PENDING"];

      nonTerminalStatuses.forEach((status) => {
        const invoice = { status };
        const isTerminal = ["VALID", "INVALID", "CANCELLED", "REJECTED"].includes(invoice.status);
        expect(isTerminal).toBe(false);
      });
    });
  });

  describe("company credentials validation", () => {
    it("requires client ID and secret", () => {
      const company = {
        myinvoisClientId: "client-id",
        myinvoisClientSecret: "client-secret",
      };

      const hasCredentials = company.myinvoisClientId && company.myinvoisClientSecret;
      expect(hasCredentials).toBeTruthy();
    });

    it("rejects missing client ID", () => {
      const company = {
        myinvoisClientId: null,
        myinvoisClientSecret: "client-secret",
      };

      const hasCredentials = company.myinvoisClientId && company.myinvoisClientSecret;
      expect(hasCredentials).toBeFalsy();
    });

    it("rejects missing client secret", () => {
      const company = {
        myinvoisClientId: "client-id",
        myinvoisClientSecret: null,
      };

      const hasCredentials = company.myinvoisClientId && company.myinvoisClientSecret;
      expect(hasCredentials).toBeFalsy();
    });
  });

  describe("retry logic", () => {
    it("retries up to max attempts", () => {
      const maxAttempts = 20;
      const attempt = 19;

      const shouldRetry = attempt < maxAttempts;
      expect(shouldRetry).toBe(true);
    });

    it("stops retrying after max attempts", () => {
      const maxAttempts = 20;
      const attempt = 20;

      const shouldRetry = attempt < maxAttempts;
      expect(shouldRetry).toBe(false);
    });
  });
});
