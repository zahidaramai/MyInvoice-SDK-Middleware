import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

describe("Metrics Plugin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ metricsEnabled: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it("exposes /metrics endpoint when enabled", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
  });

  it("returns Prometheus format metrics", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    const body = response.body;

    // Check for default Node.js metrics
    expect(body).toContain("process_cpu");
    expect(body).toContain("nodejs_");

    // Check for custom HTTP metrics
    expect(body).toContain("http_requests_total");
    expect(body).toContain("http_request_duration_seconds");
  });

  it("tracks HTTP request metrics", async () => {
    // Make a request to generate metrics
    await app.inject({
      method: "GET",
      url: "/health",
    });

    const response = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    const body = response.body;

    // Should have recorded the health check request
    expect(body).toContain('http_requests_total{method="GET"');
    expect(body).toContain('route="/health"');
  });

  it("decorates fastify with metrics registry", () => {
    expect(app.metricsRegistry).toBeDefined();
    expect(app.metrics).toBeDefined();
    expect(app.metrics.httpRequestsTotal).toBeDefined();
    expect(app.metrics.upstreamRequestsTotal).toBeDefined();
  });
});

describe("Metrics Plugin (disabled)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ metricsEnabled: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 404 when metrics disabled", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    expect(response.statusCode).toBe(404);
  });

  it("still decorates fastify with metrics for internal use", () => {
    expect(app.metricsRegistry).toBeDefined();
    expect(app.metrics).toBeDefined();
  });
});
