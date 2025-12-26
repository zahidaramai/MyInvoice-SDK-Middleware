Phase 08 will formalize **logs + metrics + tracing** and harden network behavior. For implementation choices: use **Fastify requestIdHeader** to reuse incoming correlation IDs ([Fastify][1]), **Prometheus `prom-client`** for default + custom metrics ([GitHub][2]), **Pino redaction** (built-in `redact` option / pino ecosystem) ([GitHub][3]), and optional **OpenTelemetry Fastify instrumentation** (either `@fastify/otel` or `@opentelemetry/instrumentation-fastify`) ([GitHub][4]). The overall approach aligns with common OTel + structured JSON logging patterns for Fastify apps. ([Google Cloud Documentation][5])

```text
PHASE 08 — EXECUTION PROMPT (Claude Code Opus 4.5)
Project: MyInvois Middleware Gateway (OpenAPI-first, Node/TS, OSS)

MISSION
Implement Observability + Hardening across gateway, worker, and upstream client:
- Structured logging (JSON) with strict redaction (no secrets, no document bodies)
- Prometheus metrics (/metrics) with default Node metrics + key business metrics
- Optional OpenTelemetry tracing support (feature-flagged)
- Harden upstream HTTP: timeouts, retry policy, 429/Retry-After compliance, safe error surfaces
- Add runbooks + troubleshooting docs
- Full tests (unit + route) for core behaviors

SCOPE (WHAT YOU MUST SHIP)
A) Logging (Gateway + Worker)
- Use Fastify logger (Pino) for gateway
- Use Pino for worker logs
- Always include: correlationId, trackingId, submissionUid (when available), sessionId (sanitized), env, clientId fingerprint (NOT raw secret)
- Redact at source: headers.authorization, clientSecret, access_token, document base64, cookies

B) Metrics (Gateway + Worker)
- Expose /metrics on gateway
- Expose metrics HTTP server on worker (or document how to run it)
- Collect default Node metrics
- Add custom metrics:
  1) http_requests_total{method, route, status}
  2) http_request_duration_seconds{method, route, status} (histogram)
  3) upstream_requests_total{endpoint, method, status}
  4) upstream_request_duration_seconds{endpoint, method, status} (histogram)
  5) upstream_rate_limited_total{endpoint} (counter)
  6) gateway_rate_limited_total{scope} (counter)  // local limiter denies
  7) submissions_created_total (counter)
  8) submissions_in_progress (gauge)
  9) poll_jobs_total{result} (counter: success|retry|rate_limited|finalized|error)
  10) token_cache_hits_total / token_cache_misses_total (counters)

C) Optional tracing (OpenTelemetry)
- Feature-flag tracing, default OFF:
  OTEL_ENABLED=false by default
- When enabled:
  - instrument Fastify requests + outbound fetch (if chosen)
  - propagate correlationId as trace attribute
  - export via OTLP endpoint if provided
- Choose ONE approach:
  Option 1: @fastify/otel plugin (preferred: Fastify-maintained)
  Option 2: @opentelemetry/instrumentation-fastify (+ SDK bootstrap)

D) Hardening (myinvois-client)
- Enforce strict timeouts using AbortController:
  - connect/token: 10s
  - idempotent GETs (getSubmission, validateTin): 15s
  - submissions/state changes/details: 20s (no auto-retry except auth refresh)
- Retry policy:
  - NEVER auto-retry submission (POST documentsubmissions) if any response received
  - 401 -> refresh token once -> retry once
  - Network/5xx:
     - idempotent GET: retry up to 2 times with exponential backoff (e.g., 250ms, 750ms) but obey 429
     - non-idempotent: no retries (except token refresh)
  - 429:
     - never immediate retry
     - always surface retryAfterSeconds + forward Retry-After header in gateway
- Add “circuit breaker lite” (optional):
  - if upstream 5xx spikes above threshold in 1 minute, temporarily fast-fail with 503 and retry-after (configurable)
  - If too big, skip in Phase 08; at least implement metrics + logs for it.

E) Docs / Runbooks
- Add /docs/observability.md:
  - metrics list and meaning
  - how to scrape /metrics
  - correlationId troubleshooting
  - common throttling reasons and how to tune RPM
- Add /docs/troubleshooting.md updates:
  - “429 Retry-After” handling steps
  - “DuplicateSubmission 10-min window” notes
  - “Token caching” behavior notes

NON-GOALS
- Full dashboard provisioning (Grafana json) (optional future)
- Distributed tracing collector deployment scripts (document only)
- Advanced SIEM/security scanning pipelines (future phase)

AGENT RULES
1) Do NOT change OpenAPI spec unless invalid.
2) Do NOT log secrets:
   - clientSecret, access_token, Authorization header, cookies
   - document base64 payload
   - idValue/taxpayerName raw values
3) Metrics must not label on high-cardinality values (NO trackingId/submissionUid as labels).
4) Tracing is OFF by default; must be safe to run without OTel deps enabled.
5) Keep dependencies minimal and mainstream.

DEFINITION OF DONE (DoD)
[ ] pnpm -r lint passes
[ ] pnpm -r typecheck passes
[ ] pnpm -r test passes
[ ] pnpm -r build passes
[ ] Gateway exposes /metrics (when METRICS_ENABLED=true) and returns Prometheus text format
[ ] Worker exposes metrics endpoint (or small http server) when METRICS_ENABLED=true
[ ] Default metrics collected + at least 8 custom metrics above implemented
[ ] Logs are JSON, contain correlationId, and do not leak secrets/document bodies
[ ] myinvois-client uses timeouts; retry behavior follows policy; 429 obeyed
[ ] Docs added/updated for observability + troubleshooting

DELIVERABLES (FILES/MODULES TO CREATE/UPDATE)
1) packages/core
- src/observability/metrics.ts
  - createRegistry()
  - initDefaultMetrics()
  - defineCustomMetrics()
  - helpers to inc/observe by low-cardinality labels
- src/observability/redaction.ts
  - centralized redact paths list (gateway + worker + client)
- src/observability/index.ts exports

2) apps/gateway
- src/plugins/logger.ts
  - create Pino options + redact config
- src/plugins/metrics.ts
  - register /metrics route (protected by METRICS_ENABLED)
  - attach onRequest/onResponse hooks to record request counters/histograms
- src/plugins/otel.ts (optional, feature-flagged)
- src/app.ts
  - register logger/metrics early (before routes)
- tests:
  - src/plugins/metrics.test.ts (inject /metrics)
  - src/plugins/logger.test.ts (assert redact paths configured; do not snapshot logs with secrets)
  - src/app.test.ts additions to ensure correlationId still present

3) apps/worker
- src/lib/logger.ts (pino + redact)
- src/lib/metrics.ts (prom-client registry + custom poll/job metrics)
- src/lib/metricsServer.ts (tiny Node http server exposing /metrics when enabled)
- update worker bootstrap to start metrics server on METRICS_PORT

4) packages/myinvois-client
- src/httpClient.ts updates:
  - add timeout wrapper
  - add retry policy hooks for idempotent GET only
  - emit metrics hooks (optional callback interface):
     onUpstreamRequestStart/End
     onTokenCacheHit/Miss
     onRateLimited
- src/tokenManager.ts updates:
  - emit token cache hit/miss counters

5) docs
- /docs/observability.md
- update /docs/troubleshooting.md (or create if missing)

CONFIG (ENV VARS)
Gateway:
- LOG_LEVEL=info|debug|warn|error
- METRICS_ENABLED=true|false (default false)
- METRICS_ROUTE=/metrics (default /metrics)
- OTEL_ENABLED=true|false (default false)
- OTEL_SERVICE_NAME=myinvois-gateway
- OTEL_EXPORTER_OTLP_ENDPOINT=... (optional)

Worker:
- METRICS_ENABLED=true|false
- METRICS_PORT=9091 (example)
- LOG_LEVEL=info

Client:
- UPSTREAM_TIMEOUT_TOKEN_MS=10000
- UPSTREAM_TIMEOUT_GET_MS=15000
- UPSTREAM_TIMEOUT_POST_MS=20000
- GET_RETRY_MAX=2

IMPLEMENTATION PLAN (EXECUTE IN THIS ORDER)
1) Add core observability package module (metrics + redaction paths).
2) Gateway:
   a) implement logger plugin with redact paths (Authorization, cookies, clientSecret, documents[*].document, tokens)
   b) implement /metrics plugin using prom-client registry + default metrics + HTTP metrics hooks
   c) wire into app.ts early
3) Worker:
   a) implement logger with same redaction module
   b) implement metrics registry + poll/job counters
   c) start metrics server conditionally
4) Client hardening:
   a) add AbortController timeouts in httpClient
   b) add retry only for idempotent GET (and never for submission POST)
   c) add metric callback hooks
5) Docs:
   - list all metrics and how to scrape
   - troubleshooting guidance for correlationId + 429/Retry-After
6) Tests:
   - /metrics returns content-type and includes a known custom metric line
   - ensure logger redaction config includes required paths
   - ensure 429 surfaces Retry-After and increments upstream_rate_limited_total

ACCEPTANCE COMMANDS
- pnpm -r lint
- pnpm -r typecheck
- pnpm -r test
- pnpm -r build
- (manual) METRICS_ENABLED=true pnpm --filter @myinvois/gateway dev
  curl http://localhost:<PORT>/metrics
- (manual) METRICS_ENABLED=true pnpm --filter @myinvois/worker dev
  curl http://localhost:<METRICS_PORT>/metrics

OUTPUT REQUIRED FROM YOU
1) Before coding: bullet plan of touched files
2) Implement changes
3) End report:
   - touched files
   - how redaction works + what paths redacted
   - metrics list implemented
   - how timeouts/retries work
   - commands to run locally

Start now.
```

[1]: https://fastify.io/docs/latest/Reference/Server/?utm_source=chatgpt.com "Server"
[2]: https://github.com/siimon/prom-client?utm_source=chatgpt.com "siimon/prom-client: Prometheus client for node.js"
[3]: https://github.com/pinojs/pino-noir?utm_source=chatgpt.com "pinojs/pino-noir: 🌲 pino log redaction"
[4]: https://github.com/fastify/otel?utm_source=chatgpt.com "fastify/otel: OpenTelemetry instrumentation library"
[5]: https://docs.cloud.google.com/stackdriver/docs/instrumentation/setup/nodejs?utm_source=chatgpt.com "Node.js instrumentation sample | Google Cloud Observability"
