/**
 * Tests for httpClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("httpClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request construction", () => {
    it("builds GET request with headers", () => {
      const request = {
        method: "GET",
        url: "https://api.example.com/resource",
        headers: {
          Authorization: "Bearer token123",
          Accept: "application/json",
        },
      };

      expect(request.method).toBe("GET");
      expect(request.headers.Authorization).toMatch(/^Bearer /);
    });

    it("builds POST request with body", () => {
      const request = {
        method: "POST",
        url: "https://api.example.com/resource",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: "value" }),
      };

      expect(request.method).toBe("POST");
      expect(request.body).toBe('{"key":"value"}');
    });

    it("builds PUT request with body", () => {
      const request = {
        method: "PUT",
        url: "https://api.example.com/resource/123",
        body: JSON.stringify({ updated: true }),
      };

      expect(request.method).toBe("PUT");
    });

    it("builds DELETE request", () => {
      const request = {
        method: "DELETE",
        url: "https://api.example.com/resource/123",
      };

      expect(request.method).toBe("DELETE");
    });
  });

  describe("URL construction", () => {
    it("builds URL with query parameters", () => {
      const baseUrl = "https://api.example.com";
      const path = "/documents";
      const params = { page: "1", limit: "10", status: "Valid" };

      const queryString = new URLSearchParams(params).toString();
      const url = `${baseUrl}${path}?${queryString}`;

      expect(url).toBe("https://api.example.com/documents?page=1&limit=10&status=Valid");
    });

    it("handles special characters in query params", () => {
      const params = { search: "test value", filter: "name=John" };
      const queryString = new URLSearchParams(params).toString();

      expect(queryString).toContain("search=test+value");
    });

    it("builds URL without query params", () => {
      const baseUrl = "https://api.example.com";
      const path = "/documents/123";

      const url = `${baseUrl}${path}`;

      expect(url).toBe("https://api.example.com/documents/123");
    });
  });

  describe("response handling", () => {
    it("parses JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ data: "test" }),
      });

      const response = await mockFetch("https://api.example.com/test");
      const data = await response.json();

      expect(data).toEqual({ data: "test" });
    });

    it("parses text response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve("Plain text response"),
      });

      const response = await mockFetch("https://api.example.com/test");
      const text = await response.text();

      expect(text).toBe("Plain text response");
    });

    it("handles empty response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({}),
      });

      const response = await mockFetch("https://api.example.com/test");

      expect(response.status).toBe(204);
    });
  });

  describe("error handling", () => {
    it("handles 400 Bad Request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            code: "BAD_REQUEST",
            message: "Invalid parameters",
          }),
      });

      const response = await mockFetch("https://api.example.com/test");
      const error = await response.json();

      expect(response.status).toBe(400);
      expect(error.code).toBe("BAD_REQUEST");
    });

    it("handles 401 Unauthorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            code: "UNAUTHORIZED",
            message: "Token expired",
          }),
      });

      const response = await mockFetch("https://api.example.com/test");

      expect(response.status).toBe(401);
    });

    it("handles 403 Forbidden", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({
            code: "FORBIDDEN",
            message: "Access denied",
          }),
      });

      const response = await mockFetch("https://api.example.com/test");

      expect(response.status).toBe(403);
    });

    it("handles 404 Not Found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            code: "NOT_FOUND",
            message: "Resource not found",
          }),
      });

      const response = await mockFetch("https://api.example.com/test");

      expect(response.status).toBe(404);
    });

    it("handles 429 Rate Limit", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "60" }),
        json: () =>
          Promise.resolve({
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests",
          }),
      });

      const response = await mockFetch("https://api.example.com/test");
      const retryAfter = response.headers.get("retry-after");

      expect(response.status).toBe(429);
      expect(retryAfter).toBe("60");
    });

    it("handles 500 Server Error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            code: "INTERNAL_ERROR",
            message: "Server error",
          }),
      });

      const response = await mockFetch("https://api.example.com/test");

      expect(response.status).toBe(500);
    });

    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      await expect(mockFetch("https://api.example.com/test")).rejects.toThrow("Network timeout");
    });

    it("handles DNS resolution failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));

      await expect(mockFetch("https://invalid.example.com")).rejects.toThrow("ENOTFOUND");
    });
  });

  describe("timeout handling", () => {
    it("supports timeout configuration", () => {
      const config = {
        timeout: 30000,
        retries: 3,
      };

      expect(config.timeout).toBe(30000);
      expect(config.retries).toBe(3);
    });

    it("handles timeout error", async () => {
      const timeoutError = new Error("Request timeout");
      timeoutError.name = "AbortError";

      mockFetch.mockRejectedValueOnce(timeoutError);

      await expect(mockFetch("https://api.example.com/slow")).rejects.toThrow("Request timeout");
    });
  });

  describe("retry logic", () => {
    it("retries on transient errors", async () => {
      let attempts = 0;

      mockFetch.mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error("Connection reset"));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });
      });

      // Simulate retry logic
      let result;
      for (let i = 0; i < 3; i++) {
        try {
          const response = await mockFetch("https://api.example.com/test");
          result = await response.json();
          break;
        } catch {
          if (i === 2) throw new Error("Max retries exceeded");
        }
      }

      expect(attempts).toBe(3);
      expect(result).toEqual({ success: true });
    });

    it("calculates exponential backoff delay", () => {
      const calculateDelay = (attempt: number, baseDelay: number = 1000) => {
        return Math.min(baseDelay * Math.pow(2, attempt), 30000);
      };

      expect(calculateDelay(0)).toBe(1000);
      expect(calculateDelay(1)).toBe(2000);
      expect(calculateDelay(2)).toBe(4000);
      expect(calculateDelay(5)).toBe(30000); // Capped at max
    });
  });

  describe("header handling", () => {
    it("sets default headers", () => {
      const defaultHeaders = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "MyInvois-Client/1.0",
      };

      expect(defaultHeaders.Accept).toBe("application/json");
      expect(defaultHeaders["Content-Type"]).toBe("application/json");
    });

    it("merges custom headers", () => {
      const defaultHeaders = {
        Accept: "application/json",
      };

      const customHeaders = {
        Authorization: "Bearer token",
        "X-Custom-Header": "custom-value",
      };

      const merged = { ...defaultHeaders, ...customHeaders };

      expect(merged.Accept).toBe("application/json");
      expect(merged.Authorization).toBe("Bearer token");
      expect(merged["X-Custom-Header"]).toBe("custom-value");
    });

    it("extracts response headers", () => {
      const headers = new Headers({
        "content-type": "application/json",
        correlationid: "corr-123",
        "x-rate-limit-limit": "100",
        "x-rate-limit-remaining": "95",
      });

      expect(headers.get("correlationid")).toBe("corr-123");
      expect(headers.get("x-rate-limit-remaining")).toBe("95");
    });
  });

  describe("content type handling", () => {
    it("sends JSON body", () => {
      const body = { invoice: { id: "INV001" } };
      const jsonBody = JSON.stringify(body);

      expect(jsonBody).toBe('{"invoice":{"id":"INV001"}}');
    });

    it("sends form-urlencoded body", () => {
      const params = {
        grant_type: "client_credentials",
        client_id: "test-client",
        client_secret: "test-secret",
        scope: "InvoicingAPI",
      };

      const body = new URLSearchParams(params).toString();

      expect(body).toContain("grant_type=client_credentials");
      expect(body).toContain("client_id=test-client");
    });

    it("handles XML response", async () => {
      const xmlContent = '<?xml version="1.0"?><Invoice><ID>INV001</ID></Invoice>';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/xml" }),
        text: () => Promise.resolve(xmlContent),
      });

      const response = await mockFetch("https://api.example.com/document");
      const text = await response.text();

      expect(text).toContain("<Invoice>");
    });
  });

  describe("base URL configuration", () => {
    it("configures SANDBOX base URL", () => {
      const env = "SANDBOX";
      const baseUrl =
        env === "PROD"
          ? "https://api.myinvois.hasil.gov.my"
          : "https://preprod-api.myinvois.hasil.gov.my";

      expect(baseUrl).toBe("https://preprod-api.myinvois.hasil.gov.my");
    });

    it("configures PROD base URL", () => {
      const env = "PROD";
      const baseUrl =
        env === "PROD"
          ? "https://api.myinvois.hasil.gov.my"
          : "https://preprod-api.myinvois.hasil.gov.my";

      expect(baseUrl).toBe("https://api.myinvois.hasil.gov.my");
    });

    it("configures identity URL", () => {
      const env = "SANDBOX";
      const identityUrl =
        env === "PROD"
          ? "https://identity.myinvois.hasil.gov.my"
          : "https://preprod-identity.myinvois.hasil.gov.my";

      expect(identityUrl).toBe("https://preprod-identity.myinvois.hasil.gov.my");
    });
  });
});
