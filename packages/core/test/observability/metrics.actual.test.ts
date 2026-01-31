/**
 * Actual tests for metrics module
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createRegistry,
  initDefaultMetrics,
  defineCustomMetrics,
  normalizeRoute,
  recordHttpRequest,
  recordUpstreamRequest,
  recordUpstreamRateLimit,
  recordGatewayRateLimit,
  recordPollJob,
  recordTokenCacheHit,
  recordTokenCacheMiss,
  DEFAULT_DURATION_BUCKETS,
  type CustomMetrics,
} from "../../src/observability/metrics.js";
import { Registry } from "prom-client";

describe("metrics (actual)", () => {
  describe("createRegistry", () => {
    it("creates a new Registry instance", () => {
      const registry = createRegistry();
      expect(registry).toBeInstanceOf(Registry);
    });

    it("creates independent registries", () => {
      const registry1 = createRegistry();
      const registry2 = createRegistry();
      expect(registry1).not.toBe(registry2);
    });
  });

  describe("initDefaultMetrics", () => {
    it("initializes default metrics on registry", async () => {
      const registry = createRegistry();
      initDefaultMetrics(registry);
      // Default metrics are registered - we can verify by getting metrics
      const output = await registry.metrics();
      expect(output.length).toBeGreaterThan(0);
    });

    it("initializes default metrics with prefix", async () => {
      const registry = createRegistry();
      initDefaultMetrics(registry, "test_");
      const output = await registry.metrics();
      // At least one metric should have the prefix
      expect(output).toContain("test_");
    });
  });

  describe("defineCustomMetrics", () => {
    it("defines all custom metrics", () => {
      const registry = createRegistry();
      const metrics = defineCustomMetrics(registry);

      expect(metrics.httpRequestsTotal).toBeDefined();
      expect(metrics.httpRequestDuration).toBeDefined();
      expect(metrics.upstreamRequestsTotal).toBeDefined();
      expect(metrics.upstreamRequestDuration).toBeDefined();
      expect(metrics.upstreamRateLimitedTotal).toBeDefined();
      expect(metrics.gatewayRateLimitedTotal).toBeDefined();
      expect(metrics.submissionsCreatedTotal).toBeDefined();
      expect(metrics.submissionsInProgress).toBeDefined();
      expect(metrics.pollJobsTotal).toBeDefined();
      expect(metrics.tokenCacheHitsTotal).toBeDefined();
      expect(metrics.tokenCacheMissesTotal).toBeDefined();
    });

    it("defines metrics with prefix", async () => {
      const registry = createRegistry();
      defineCustomMetrics(registry, "myapp_");

      const output = await registry.metrics();
      expect(output).toContain("myapp_http_requests_total");
    });

    it("registers metrics on the provided registry", async () => {
      const registry = createRegistry();
      defineCustomMetrics(registry);

      const output = await registry.metrics();
      expect(output).toContain("http_requests_total");
      expect(output).toContain("http_request_duration_seconds");
      expect(output).toContain("upstream_requests_total");
    });
  });

  describe("normalizeRoute", () => {
    it("replaces UUID patterns", () => {
      const result = normalizeRoute("/api/v1/documents/550e8400-e29b-41d4-a716-446655440000");
      expect(result).toBe("/api/v1/documents/:uuid");
    });

    it("replaces session ID patterns", () => {
      const result = normalizeRoute("/api/v1/sessions/sess_abc123xyz");
      expect(result).toBe("/api/v1/sessions/:sessionId");
    });

    it("replaces tracking ID patterns", () => {
      const result = normalizeRoute("/api/v1/documents/trk_abc123xyz/status");
      expect(result).toBe("/api/v1/documents/:trackingId/status");
    });

    it("replaces numeric IDs", () => {
      const result = normalizeRoute("/api/v1/users/12345");
      expect(result).toBe("/api/v1/users/:id");
    });

    it("replaces multiple patterns in same path", () => {
      const result = normalizeRoute(
        "/api/v1/users/123/documents/550e8400-e29b-41d4-a716-446655440000"
      );
      expect(result).toBe("/api/v1/users/:id/documents/:uuid");
    });

    it("preserves paths without dynamic segments", () => {
      const result = normalizeRoute("/api/v1/health");
      expect(result).toBe("/api/v1/health");
    });

    it("handles uppercase UUID", () => {
      const result = normalizeRoute("/api/v1/docs/550E8400-E29B-41D4-A716-446655440000");
      expect(result).toBe("/api/v1/docs/:uuid");
    });
  });

  describe("DEFAULT_DURATION_BUCKETS", () => {
    it("exports default duration buckets array", () => {
      expect(DEFAULT_DURATION_BUCKETS).toEqual([0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
    });
  });

  describe("recordHttpRequest", () => {
    let metrics: CustomMetrics;

    beforeEach(() => {
      const registry = createRegistry();
      metrics = defineCustomMetrics(registry);
    });

    it("increments request counter", async () => {
      recordHttpRequest(metrics, { method: "GET", route: "/api/test", status: "200" }, 0.05);

      const counter = await metrics.httpRequestsTotal.get();
      expect(counter.values[0].value).toBe(1);
    });

    it("records duration histogram", async () => {
      recordHttpRequest(metrics, { method: "POST", route: "/api/submit", status: "201" }, 0.123);

      const histogram = await metrics.httpRequestDuration.get();
      expect(histogram.values.length).toBeGreaterThan(0);
    });
  });

  describe("recordUpstreamRequest", () => {
    let metrics: CustomMetrics;

    beforeEach(() => {
      const registry = createRegistry();
      metrics = defineCustomMetrics(registry);
    });

    it("increments upstream request counter", async () => {
      recordUpstreamRequest(
        metrics,
        { endpoint: "/api/v1.0/documents", method: "POST", status: "202" },
        0.5
      );

      const counter = await metrics.upstreamRequestsTotal.get();
      expect(counter.values[0].value).toBe(1);
    });

    it("records upstream duration histogram", async () => {
      recordUpstreamRequest(
        metrics,
        { endpoint: "/connect/token", method: "POST", status: "200" },
        0.25
      );

      const histogram = await metrics.upstreamRequestDuration.get();
      expect(histogram.values.length).toBeGreaterThan(0);
    });
  });

  describe("recordUpstreamRateLimit", () => {
    let metrics: CustomMetrics;

    beforeEach(() => {
      const registry = createRegistry();
      metrics = defineCustomMetrics(registry);
    });

    it("increments upstream rate limit counter", async () => {
      recordUpstreamRateLimit(metrics, "/api/v1.0/documents");

      const counter = await metrics.upstreamRateLimitedTotal.get();
      expect(counter.values[0].value).toBe(1);
      expect(counter.values[0].labels.endpoint).toBe("/api/v1.0/documents");
    });
  });

  describe("recordGatewayRateLimit", () => {
    let metrics: CustomMetrics;

    beforeEach(() => {
      const registry = createRegistry();
      metrics = defineCustomMetrics(registry);
    });

    it("increments gateway rate limit counter", async () => {
      recordGatewayRateLimit(metrics, "login");

      const counter = await metrics.gatewayRateLimitedTotal.get();
      expect(counter.values[0].value).toBe(1);
      expect(counter.values[0].labels.scope).toBe("login");
    });
  });

  describe("recordPollJob", () => {
    let metrics: CustomMetrics;

    beforeEach(() => {
      const registry = createRegistry();
      metrics = defineCustomMetrics(registry);
    });

    it("increments poll job counter with success result", async () => {
      recordPollJob(metrics, "success");

      const counter = await metrics.pollJobsTotal.get();
      expect(counter.values[0].value).toBe(1);
      expect(counter.values[0].labels.result).toBe("success");
    });

    it("increments poll job counter with retry result", async () => {
      recordPollJob(metrics, "retry");

      const counter = await metrics.pollJobsTotal.get();
      expect(counter.values[0].value).toBe(1);
      expect(counter.values[0].labels.result).toBe("retry");
    });

    it("increments poll job counter with rate_limited result", async () => {
      recordPollJob(metrics, "rate_limited");

      const counter = await metrics.pollJobsTotal.get();
      expect(counter.values[0].value).toBe(1);
    });

    it("increments poll job counter with finalized result", async () => {
      recordPollJob(metrics, "finalized");

      const counter = await metrics.pollJobsTotal.get();
      expect(counter.values[0].value).toBe(1);
    });

    it("increments poll job counter with error result", async () => {
      recordPollJob(metrics, "error");

      const counter = await metrics.pollJobsTotal.get();
      expect(counter.values[0].value).toBe(1);
    });
  });

  describe("recordTokenCacheHit", () => {
    let metrics: CustomMetrics;

    beforeEach(() => {
      const registry = createRegistry();
      metrics = defineCustomMetrics(registry);
    });

    it("increments token cache hits counter", async () => {
      recordTokenCacheHit(metrics);

      const counter = await metrics.tokenCacheHitsTotal.get();
      expect(counter.values[0].value).toBe(1);
    });

    it("increments multiple times", async () => {
      recordTokenCacheHit(metrics);
      recordTokenCacheHit(metrics);
      recordTokenCacheHit(metrics);

      const counter = await metrics.tokenCacheHitsTotal.get();
      expect(counter.values[0].value).toBe(3);
    });
  });

  describe("recordTokenCacheMiss", () => {
    let metrics: CustomMetrics;

    beforeEach(() => {
      const registry = createRegistry();
      metrics = defineCustomMetrics(registry);
    });

    it("increments token cache misses counter", async () => {
      recordTokenCacheMiss(metrics);

      const counter = await metrics.tokenCacheMissesTotal.get();
      expect(counter.values[0].value).toBe(1);
    });

    it("increments multiple times", async () => {
      recordTokenCacheMiss(metrics);
      recordTokenCacheMiss(metrics);

      const counter = await metrics.tokenCacheMissesTotal.get();
      expect(counter.values[0].value).toBe(2);
    });
  });

  describe("submissions metrics", () => {
    let metrics: CustomMetrics;

    beforeEach(() => {
      const registry = createRegistry();
      metrics = defineCustomMetrics(registry);
    });

    it("increments submissions created counter", async () => {
      metrics.submissionsCreatedTotal.inc();

      const counter = await metrics.submissionsCreatedTotal.get();
      expect(counter.values[0].value).toBe(1);
    });

    it("sets submissions in progress gauge", async () => {
      metrics.submissionsInProgress.set(5);

      const gauge = await metrics.submissionsInProgress.get();
      expect(gauge.values[0].value).toBe(5);
    });

    it("increments and decrements submissions in progress", async () => {
      metrics.submissionsInProgress.inc();
      metrics.submissionsInProgress.inc();
      metrics.submissionsInProgress.dec();

      const gauge = await metrics.submissionsInProgress.get();
      expect(gauge.values[0].value).toBe(1);
    });
  });
});
