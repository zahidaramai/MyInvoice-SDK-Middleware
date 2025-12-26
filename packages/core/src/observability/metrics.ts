/**
 * Prometheus metrics setup using prom-client
 * Provides default Node.js metrics + custom business metrics
 */

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
  type CounterConfiguration,
  type HistogramConfiguration,
  type GaugeConfiguration,
} from "prom-client";

/**
 * Create a new Prometheus registry
 */
export function createRegistry(): Registry {
  return new Registry();
}

/**
 * Initialize default Node.js metrics on the registry
 */
export function initDefaultMetrics(registry: Registry, prefix = ""): void {
  collectDefaultMetrics({
    register: registry,
    prefix,
  });
}

/**
 * HTTP request labels (low cardinality)
 */
export interface HttpLabels {
  method: string;
  route: string;
  status: string;
}

/**
 * Upstream request labels (low cardinality)
 */
export interface UpstreamLabels {
  endpoint: string;
  method: string;
  status: string;
}

/**
 * Poll job result labels
 */
export type PollJobResult = "success" | "retry" | "rate_limited" | "finalized" | "error";

/**
 * Custom metrics definitions for the gateway and worker
 */
export interface CustomMetrics {
  // HTTP metrics (gateway)
  httpRequestsTotal: Counter<"method" | "route" | "status">;
  httpRequestDuration: Histogram<"method" | "route" | "status">;

  // Upstream metrics (client)
  upstreamRequestsTotal: Counter<"endpoint" | "method" | "status">;
  upstreamRequestDuration: Histogram<"endpoint" | "method" | "status">;
  upstreamRateLimitedTotal: Counter<"endpoint">;

  // Gateway rate limiter metrics
  gatewayRateLimitedTotal: Counter<"scope">;

  // Submission metrics
  submissionsCreatedTotal: Counter<string>;
  submissionsInProgress: Gauge<string>;

  // Poll job metrics (worker)
  pollJobsTotal: Counter<"result">;

  // Token cache metrics
  tokenCacheHitsTotal: Counter<string>;
  tokenCacheMissesTotal: Counter<string>;
}

/**
 * Default histogram buckets for request duration (in seconds)
 */
export const DEFAULT_DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Define and register all custom metrics
 */
export function defineCustomMetrics(registry: Registry, prefix = ""): CustomMetrics {
  const httpRequestsTotal = new Counter({
    name: `${prefix}http_requests_total`,
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status"] as const,
    registers: [registry],
  } as CounterConfiguration<"method" | "route" | "status">);

  const httpRequestDuration = new Histogram({
    name: `${prefix}http_request_duration_seconds`,
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status"] as const,
    buckets: DEFAULT_DURATION_BUCKETS,
    registers: [registry],
  } as HistogramConfiguration<"method" | "route" | "status">);

  const upstreamRequestsTotal = new Counter({
    name: `${prefix}upstream_requests_total`,
    help: "Total number of upstream API requests",
    labelNames: ["endpoint", "method", "status"] as const,
    registers: [registry],
  } as CounterConfiguration<"endpoint" | "method" | "status">);

  const upstreamRequestDuration = new Histogram({
    name: `${prefix}upstream_request_duration_seconds`,
    help: "Upstream API request duration in seconds",
    labelNames: ["endpoint", "method", "status"] as const,
    buckets: DEFAULT_DURATION_BUCKETS,
    registers: [registry],
  } as HistogramConfiguration<"endpoint" | "method" | "status">);

  const upstreamRateLimitedTotal = new Counter({
    name: `${prefix}upstream_rate_limited_total`,
    help: "Total number of upstream rate limit responses (429)",
    labelNames: ["endpoint"] as const,
    registers: [registry],
  } as CounterConfiguration<"endpoint">);

  const gatewayRateLimitedTotal = new Counter({
    name: `${prefix}gateway_rate_limited_total`,
    help: "Total number of requests denied by local rate limiter",
    labelNames: ["scope"] as const,
    registers: [registry],
  } as CounterConfiguration<"scope">);

  const submissionsCreatedTotal = new Counter({
    name: `${prefix}submissions_created_total`,
    help: "Total number of submissions created",
    registers: [registry],
  });

  const submissionsInProgress = new Gauge({
    name: `${prefix}submissions_in_progress`,
    help: "Number of submissions currently being polled",
    registers: [registry],
  } as GaugeConfiguration<string>);

  const pollJobsTotal = new Counter({
    name: `${prefix}poll_jobs_total`,
    help: "Total number of poll jobs processed",
    labelNames: ["result"] as const,
    registers: [registry],
  } as CounterConfiguration<"result">);

  const tokenCacheHitsTotal = new Counter({
    name: `${prefix}token_cache_hits_total`,
    help: "Total number of token cache hits",
    registers: [registry],
  });

  const tokenCacheMissesTotal = new Counter({
    name: `${prefix}token_cache_misses_total`,
    help: "Total number of token cache misses",
    registers: [registry],
  });

  return {
    httpRequestsTotal,
    httpRequestDuration,
    upstreamRequestsTotal,
    upstreamRequestDuration,
    upstreamRateLimitedTotal,
    gatewayRateLimitedTotal,
    submissionsCreatedTotal,
    submissionsInProgress,
    pollJobsTotal,
    tokenCacheHitsTotal,
    tokenCacheMissesTotal,
  };
}

/**
 * Normalize route for metrics (avoid high cardinality from path params)
 */
export function normalizeRoute(path: string): string {
  // Replace common path parameter patterns
  return path
    .replace(/\/sess_[a-zA-Z0-9]+/g, "/:sessionId")
    .replace(/\/trk_[a-zA-Z0-9]+/g, "/:trackingId")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .replace(/\/[0-9]+/g, "/:id");
}

/**
 * Helper to record HTTP request metrics
 */
export function recordHttpRequest(
  metrics: CustomMetrics,
  labels: HttpLabels,
  durationSeconds: number
): void {
  metrics.httpRequestsTotal.inc(labels);
  metrics.httpRequestDuration.observe(labels, durationSeconds);
}

/**
 * Helper to record upstream request metrics
 */
export function recordUpstreamRequest(
  metrics: CustomMetrics,
  labels: UpstreamLabels,
  durationSeconds: number
): void {
  metrics.upstreamRequestsTotal.inc(labels);
  metrics.upstreamRequestDuration.observe(labels, durationSeconds);
}

/**
 * Helper to record upstream rate limit
 */
export function recordUpstreamRateLimit(metrics: CustomMetrics, endpoint: string): void {
  metrics.upstreamRateLimitedTotal.inc({ endpoint });
}

/**
 * Helper to record gateway rate limit denial
 */
export function recordGatewayRateLimit(metrics: CustomMetrics, scope: string): void {
  metrics.gatewayRateLimitedTotal.inc({ scope });
}

/**
 * Helper to record poll job result
 */
export function recordPollJob(metrics: CustomMetrics, result: PollJobResult): void {
  metrics.pollJobsTotal.inc({ result });
}

/**
 * Helper to record token cache hit
 */
export function recordTokenCacheHit(metrics: CustomMetrics): void {
  metrics.tokenCacheHitsTotal.inc();
}

/**
 * Helper to record token cache miss
 */
export function recordTokenCacheMiss(metrics: CustomMetrics): void {
  metrics.tokenCacheMissesTotal.inc();
}
