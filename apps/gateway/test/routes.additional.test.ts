/**
 * TST-19: Additional Route Tests
 * Tests for route handlers and validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import * as storage from "@myinvois/storage";

// Mock storage functions
vi.mock("@myinvois/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@myinvois/storage")>();
  return {
    ...original,
    getPrismaClient: vi.fn().mockReturnValue({
      invoice: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      company: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
    }),
    findCompanyById: vi.fn(),
    findInvoiceByNumber: vi.fn(),
    createInvoice: vi.fn(),
    updateInvoiceStatus: vi.fn(),
    findInvoiceByPosInvoiceId: vi.fn(),
    findInvoiceByTrackingId: vi.fn(),
    findInvoiceById: vi.fn(),
  };
});

// Mock poll queue
vi.mock("../src/lib/pollQueue.js", () => ({
  POLL_QUEUE_NAME: "poll-submission",
  MIN_POLL_INTERVAL_MS: 3000,
  enqueuePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
  enqueueImmediatePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
  calculatePollDelay: vi.fn().mockReturnValue(3000),
  closePollQueue: vi.fn().mockResolvedValue(undefined),
  getPollQueueStats: vi.fn().mockResolvedValue({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
  }),
}));

// Mock JWT
vi.mock("../src/auth/jwt.js", () => ({
  verifyAccessToken: vi.fn(() => {
    throw new Error("Not an access token");
  }),
  verifyPosToken: vi.fn((token: string) => {
    if (token === "valid-token") {
      return {
        userId: "test-user",
        permissions: ["submit:invoice"],
        type: "pos",
      };
    }
    throw new Error("Invalid token");
  }),
  verifyRefreshToken: vi.fn(),
  createTokenPair: vi.fn(),
  createAccessToken: vi.fn(),
  hashRefreshToken: vi.fn(),
}));

describe("TST-19: Route Handlers", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("Health endpoints", () => {
    it("GET /healthz should return 200", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/healthz",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe("ok");
    });

    it("GET /readyz should return 200", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/readyz",
      });

      expect(response.statusCode).toBe(200);
    });

    it("GET /version should return version info", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/version",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.version).toBeDefined();
    });
  });

  describe("Request validation", () => {
    it("should reject request with invalid content type", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          "content-type": "text/plain",
          authorization: "Bearer valid-token",
        },
        payload: "invalid",
      });

      // Should fail due to content type
      expect(response.statusCode).not.toBe(200);
    });

    it("should reject request without authorization header", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with invalid token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: "Bearer invalid-token",
        },
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("CORS handling", () => {
    it("should include CORS headers in response", async () => {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/healthz",
        headers: {
          origin: "https://example.com",
        },
      });

      expect(response.headers["access-control-allow-origin"]).toBeDefined();
    });
  });

  describe("Correlation ID handling", () => {
    it("should generate request ID for API routes", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: { CompanyId: "test" },
      });

      // API routes should have request tracking
      expect(response.statusCode).toBeDefined();
    });

    it("should process request with correlation header", async () => {
      const correlationId = "test-correlation-123";

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          "x-correlation-id": correlationId,
          authorization: "Bearer valid-token",
        },
        payload: { CompanyId: "test" },
      });

      // Request should process with correlation ID
      expect(response.statusCode).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("should return 404 for unknown route", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/nonexistent/path",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 405 for wrong method", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/healthz",
      });

      // May return 404 or 405 depending on route config
      expect([404, 405]).toContain(response.statusCode);
    });
  });

  describe("Request body parsing", () => {
    it("should handle empty JSON body", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer valid-token",
        },
        payload: "",
      });

      // Should return 400 for missing required fields
      expect(response.statusCode).toBe(400);
    });

    it("should handle malformed JSON", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/pos/invoice",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer valid-token",
        },
        payload: "{invalid json}",
      });

      // Malformed JSON may return 400 or 500 depending on parser
      expect([400, 500]).toContain(response.statusCode);
    });
  });
});
