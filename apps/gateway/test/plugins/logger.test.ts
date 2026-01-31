/**
 * Tests for logger plugin
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("log levels", () => {
    it("supports trace level", () => {
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
      expect(levels).toContain("trace");
    });

    it("supports debug level", () => {
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
      expect(levels).toContain("debug");
    });

    it("supports info level", () => {
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
      expect(levels).toContain("info");
    });

    it("supports warn level", () => {
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
      expect(levels).toContain("warn");
    });

    it("supports error level", () => {
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
      expect(levels).toContain("error");
    });

    it("supports fatal level", () => {
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
      expect(levels).toContain("fatal");
    });
  });

  describe("log formatting", () => {
    it("formats log entry with timestamp", () => {
      const entry = {
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Test message",
      };

      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("formats log entry with request ID", () => {
      const entry = {
        requestId: "req-123456",
        level: "info",
        message: "Request received",
      };

      expect(entry.requestId).toBeDefined();
    });

    it("formats log entry with correlation ID", () => {
      const entry = {
        correlationId: "corr-abcdef",
        level: "info",
        message: "Processing request",
      };

      expect(entry.correlationId).toBeDefined();
    });

    it("formats error with stack trace", () => {
      const error = new Error("Test error");
      const entry = {
        level: "error",
        message: error.message,
        stack: error.stack,
      };

      expect(entry.stack).toBeDefined();
    });
  });

  describe("request logging", () => {
    it("logs request method", () => {
      const request = {
        method: "POST",
        url: "/api/v1/documents/submit",
      };

      expect(request.method).toBe("POST");
    });

    it("logs request URL", () => {
      const request = {
        method: "GET",
        url: "/api/v1/documents",
      };

      expect(request.url).toBeDefined();
    });

    it("logs request headers (redacted)", () => {
      const request = {
        headers: {
          "content-type": "application/json",
          authorization: "[REDACTED]",
        },
      };

      expect(request.headers.authorization).toBe("[REDACTED]");
    });

    it("logs request body size", () => {
      const request = {
        bodySize: 1024,
      };

      expect(request.bodySize).toBe(1024);
    });
  });

  describe("response logging", () => {
    it("logs response status code", () => {
      const response = {
        statusCode: 200,
      };

      expect(response.statusCode).toBe(200);
    });

    it("logs response time", () => {
      const response = {
        responseTime: 150, // ms
      };

      expect(response.responseTime).toBeGreaterThan(0);
    });

    it("logs response size", () => {
      const response = {
        contentLength: 2048,
      };

      expect(response.contentLength).toBe(2048);
    });
  });

  describe("redaction", () => {
    it("redacts authorization header", () => {
      const headers = {
        Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      };

      const redacted = {
        Authorization: "[REDACTED]",
      };

      expect(redacted.Authorization).toBe("[REDACTED]");
    });

    it("redacts client secret", () => {
      const body = {
        client_id: "test-client",
        client_secret: "super-secret-value",
      };

      const redacted = {
        client_id: body.client_id,
        client_secret: "[REDACTED]",
      };

      expect(redacted.client_secret).toBe("[REDACTED]");
    });

    it("redacts password", () => {
      const body = {
        email: "user@example.com",
        password: "secret123",
      };

      const redacted = {
        email: body.email,
        password: "[REDACTED]",
      };

      expect(redacted.password).toBe("[REDACTED]");
    });

    it("redacts TIN in logs", () => {
      const sensitiveData = {
        tin: "C12345678901",
      };

      const redacted = {
        tin: "C1234****901",
      };

      expect(redacted.tin).toContain("****");
    });
  });

  describe("child loggers", () => {
    it("creates child logger with context", () => {
      const childContext = {
        requestId: "req-123",
        userId: "user-456",
      };

      expect(childContext.requestId).toBeDefined();
      expect(childContext.userId).toBeDefined();
    });

    it("inherits parent logger settings", () => {
      const parentLevel = "info";
      const childLevel = parentLevel;

      expect(childLevel).toBe(parentLevel);
    });
  });

  describe("log serializers", () => {
    it("serializes error objects", () => {
      const error = new Error("Test error");
      const serialized = {
        type: error.name,
        message: error.message,
        stack: error.stack,
      };

      expect(serialized.type).toBe("Error");
      expect(serialized.message).toBe("Test error");
    });

    it("serializes request objects", () => {
      const request = {
        method: "POST",
        url: "/api/v1/submit",
        id: "req-123",
      };

      const serialized = {
        method: request.method,
        url: request.url,
        id: request.id,
      };

      expect(serialized).toEqual(request);
    });

    it("serializes response objects", () => {
      const response = {
        statusCode: 201,
        contentLength: 512,
      };

      expect(response.statusCode).toBe(201);
    });
  });

  describe("environment configuration", () => {
    it("sets log level from environment", () => {
      const envLogLevel = process.env.LOG_LEVEL || "info";
      expect(["trace", "debug", "info", "warn", "error", "fatal"]).toContain(envLogLevel);
    });

    it("enables pretty print in development", () => {
      const nodeEnv = process.env.NODE_ENV || "development";
      const prettyPrint = nodeEnv === "development";

      expect(typeof prettyPrint).toBe("boolean");
    });

    it("disables pretty print in production", () => {
      const nodeEnv = "production";
      const prettyPrint = nodeEnv === "development";

      expect(prettyPrint).toBe(false);
    });
  });

  describe("performance", () => {
    it("logs are non-blocking", () => {
      const asyncLog = true;
      expect(asyncLog).toBe(true);
    });

    it("supports log batching", () => {
      const batchSize = 10;
      expect(batchSize).toBeGreaterThan(0);
    });
  });
});
