Phase 02 is where we establish the **Fastify gateway skeleton** with a **single error contract**, **correlationId propagation**, and a **test harness using `fastify.inject()`** (so tests run without opening ports). Fastify’s docs explicitly call out using `setErrorHandler` for centralized error handling (and that 404s require `setNotFoundHandler`) ([fastify.io][1]), request ID tracking via `requestIdHeader`/`genReqId` ([fastify.io][2]), and `.inject()` as the recommended testing approach ([fastify.io][3]).

```text
PROMPT FILE: /prompts/promptPhase02_Gateway_Skeleton.md
TARGET MODEL: Claude Code Opus 4.5
PHASE: 02 — Gateway Skeleton (Fastify + Contract Alignment)

========================
0) SHORT PRD (PHASE 02)
========================
Goal:
- Build a production-grade Fastify gateway skeleton aligned to openapi/openapi.yaml:
  - correlationId propagation
  - unified ErrorEnvelope responses
  - health endpoints implemented
  - v1 endpoints registered as contract-aligned stubs (returning spec-compatible 500 ErrorEnvelope, not 501)

Why:
- We need an integration-ready gateway foundation (logging, hooks, error normalization, tests) before upstream logic arrives in Phase 03+.
- Contract alignment must start now to prevent drift.

Success criteria:
- apps/gateway starts and serves:
  - GET /healthz
  - GET /readyz
  - GET /version
- correlationId header is returned on every response
- unknown routes return ErrorEnvelope via custom not-found handler (404 is not caught by setErrorHandler)
- all spec paths/methods are registered (health routes real, v1 routes stubbed but spec-compatible)
- tests use Fastify inject (no real listen)
- code structure supports later plugin encapsulation: routes/, plugins/, lib/

In-scope:
- apps/gateway Fastify app factory + server entrypoint
- error normalization + 404 handler
- correlationId lifecycle hook
- contract route registration + OpenAPI coverage test
- minimal config loader (env)
- vitest tests for health + correlationId + error envelope

Out-of-scope:
- real MyInvois upstream integration
- sessions persistence, redis, bullmq
- OpenAPI generation/SDK workflows

========================
1) AGENT RULES
========================
- Do NOT modify openapi/openapi.yaml except if absolutely required to fix invalid spec.
- Do NOT add business logic. All v1 endpoints are stubs returning spec-compatible 500 ErrorEnvelope.
- Use Fastify plugin architecture; keep files small and modular.
- Use Fastify request id as the base for correlationId:
  - accept incoming "x-correlation-id" (preferred) and generate one if missing
  - always respond with header "correlationId" = request.id
- Centralize error responses:
  - setErrorHandler for runtime errors
  - setNotFoundHandler for 404s (must return ErrorEnvelope)
- Keep dependencies minimal; avoid heavy frameworks.

========================
2) DEFINITION OF DONE (DoD)
========================
[ ] pnpm -r typecheck passes
[ ] pnpm -r lint passes
[ ] pnpm -r test passes
[ ] pnpm -r build passes
[ ] Gateway exposes health endpoints with stable JSON responses:
    - /healthz -> { status: "ok" }
    - /readyz  -> { status: "ready" }
    - /version -> { name, version, commit? }
[ ] Every response includes header "correlationId"
[ ] 404 returns ErrorEnvelope with httpStatus=404
[ ] All paths+methods in openapi/openapi.yaml are registered in Fastify (stubs ok)
[ ] OpenAPI coverage test exists:
    - parses openapi/openapi.yaml
    - asserts each (method,path) exists in fastify routes list
[ ] No secrets, no credentials, no upstream calls

========================
3) DELIVERABLES (FILES)
========================
Create/update under apps/gateway:

/apps/gateway/src/app.ts
/apps/gateway/src/server.ts
/apps/gateway/src/config.ts
/apps/gateway/src/plugins/correlationId.ts
/apps/gateway/src/plugins/errorHandler.ts
/apps/gateway/src/routes/health.ts
/apps/gateway/src/routes/v1.stub.ts
/apps/gateway/src/lib/openapiCoverage.ts
/apps/gateway/src/lib/errors.ts
/apps/gateway/src/app.test.ts
/apps/gateway/src/openapiCoverage.test.ts

Also ensure:
- apps/gateway/package.json scripts: dev, build, typecheck, lint, test
- root scripts already exist from Phase 00

========================
4) CONTRACT REQUIREMENTS (MUST MATCH SPEC)
========================
A) ErrorEnvelope:
- Response body MUST be: { error: GatewayError }
- GatewayError MUST include:
  - httpStatus (number)
  - messageEN (string)
- Add optional fields if already in spec (e.g., code, details, messageMS)

B) Headers:
- Always set response header "correlationId" for every route and error path.
- For now, Retry-After only when we implement 429/409 later.

C) Stub routes behavior:
- For v1 routes, reply with:
  - status 500 (since spec defines 500 everywhere)
  - ErrorEnvelope with code="NOT_IMPLEMENTED" and messageEN indicating Phase 02 stub

========================
5) IMPLEMENTATION STEPS (EXECUTION PLAN)
========================
Step A — App factory (testable)
1) Implement buildApp(opts) in src/app.ts:
   - creates fastify instance
   - configures logger:
     - enabled in production/dev; disabled in test by default
   - sets requestIdHeader to "x-correlation-id" so incoming ID is reused when present
   - registers plugins:
     - correlationId plugin (sets response header onSend)
     - errorHandler plugin (setErrorHandler + setNotFoundHandler)
   - registers routes:
     - health routes (real)
     - v1 stub routes (register all spec endpoints)

2) src/server.ts:
   - imports buildApp
   - reads config
   - listens on host/port
   - handles SIGTERM/SIGINT graceful close

Step B — correlationId plugin
3) Implement plugins/correlationId.ts:
   - onRequest: ensure request.id exists (Fastify provides request id)
   - onSend: set reply.header("correlationId", request.id)
   - also set request.log bindings or add request.id into log context if needed

Step C — error handler plugin
4) Implement plugins/errorHandler.ts:
   - setErrorHandler:
     - map thrown errors to ErrorEnvelope
     - if error has statusCode use it; else 500
     - always include correlationId header (already done by plugin)
   - setNotFoundHandler:
     - return 404 ErrorEnvelope
   - ensure content-type application/json on errors

Step D — health routes
5) routes/health.ts:
   - GET /healthz -> { status: "ok" }
   - GET /readyz  -> { status: "ready" }
   - GET /version -> { name, version, node, commit? }
   - source version from package.json; commit optional from env GIT_SHA

Step E — v1 stub routes
6) routes/v1.stub.ts:
   - Register ALL v1 routes listed in spec with exact method+path
   - Each handler returns:
     - status 500
     - { error: { httpStatus: 500, code: "NOT_IMPLEMENTED", messageEN: "Phase 02 stub. Implemented in Phase 03+." } }

Step F — OpenAPI coverage test
7) lib/openapiCoverage.ts:
   - read openapi/openapi.yaml from repo root
   - parse YAML
   - extract all paths and methods
   - produce list of expected routes: { method, url }

8) openapiCoverage.test.ts:
   - build app
   - fetch fastify.printRoutes() OR inspect fastify routes API
   - assert every expected route exists
   - exclude servers/params differences by normalizing path templates:
     - OpenAPI uses {id}; Fastify path uses :id
     - convert OpenAPI templates into Fastify style before matching

Step G — tests
9) app.test.ts:
   - uses app.inject() to test:
     - health endpoints return correct payload + 200
     - response includes correlationId header
     - unknown route returns 404 ErrorEnvelope shape + correlationId
     - one v1 stub endpoint returns 500 ErrorEnvelope code NOT_IMPLEMENTED

========================
6) ACCEPTANCE TESTS (MUST RUN)
========================
- pnpm install
- pnpm -r typecheck
- pnpm -r lint
- pnpm -r test
- pnpm -r build
- pnpm --filter @myinvois/gateway dev (optional manual)

========================
7) COMPLETION REPORT FORMAT (MANDATORY)
========================
Output at end:
- Files created/updated (grouped: core app, plugins, routes, tests)
- Key decisions:
  - how correlationId is derived and returned
  - how 404 vs runtime errors are handled
  - how OpenAPI coverage test normalizes templates
- Commands to run
- Phase 03 prerequisites (what is ready for upstream auth)

========================
NOW EXECUTE PHASE 02
========================
Implement everything above in apps/gateway. If you find existing gateway code, refactor minimally to conform, preserving existing behavior where possible.
```

[1]: https://fastify.io/docs/latest/Reference/Server/ "Server | Fastify"
[2]: https://fastify.io/docs/v5.4.x/Reference/Logging/ "Logging | Fastify"
[3]: https://fastify.io/docs/v5.2.x/Guides/Testing/ "Testing | Fastify"
