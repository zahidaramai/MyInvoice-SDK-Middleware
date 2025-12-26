## Master Playbook: MyInvois Middleware Gateway (OpenAPI v1, Node/TS, OSS)

This playbook locks to **MyInvois API 1.0** integration practices: **cache tokens for ~60 minutes**, **poll Get Submission every 3–5s**, **avoid using document APIs for submission monitoring**, and respect the **recommended RPM caps per endpoint**. ([MyInvois SDK][1])

---

# Project principles (non-negotiable)

1. **OpenAPI is the product**

* `openapi/openapi.yaml` is the source of truth.
* Code must conform to spec; spec changes require regenerated SDKs + changelog.

2. **Healthy integration defaults**

* Tokens cached for the token lifetime (default 60 minutes). ([MyInvois SDK][1])
* Submission monitoring ONLY via **Get Submission** with **3–5s polling** (avoid throttling). ([MyInvois SDK][2])

3. **Rate-limit aware by design**

* Follow MyInvois recommended RPM list (Login 12, Submit 100, Get Submission 300, Cancel/Reject 12, etc.). ([MyInvois SDK][1])

4. **Stable error contract**

* Always return a normalized error envelope and surface `correlationId` + `Retry-After` where present (gateway must make debugging easier than raw upstream). ([MyInvois SDK][2])

---

# Repo architecture (target)

```
/openapi/openapi.yaml
/.spectral.yaml
/clients/                      # generated (TS/Python/C#/Java)
/apps/gateway                  # Fastify HTTP gateway
/apps/worker                   # BullMQ polling worker
/packages/contracts            # Zod schemas + OpenAPI helpers (optional)
/packages/myinvois-client      # upstream API client (auth, headers, retries)
/packages/core                 # rate limit, error normalization, hashing helpers
/packages/storage              # Prisma + Postgres (SQLite dev)
/docker/docker-compose.yml
/.github/workflows/            # lint, test, generate SDK PR
/docs/                         # integration guide, troubleshooting, contributing
```

---

# Phase roadmap (OSS-ready)

### Phase 00 — Bootstrap & governance

**Outputs:** monorepo scaffold, licenses, contribution + security docs, local dev baseline.

### Phase 01 — Contract-first (OpenAPI + Spectral)

**Outputs:** final `openapi.yaml`, `.spectral.yaml`, spec lint in CI.

### Phase 02 — Gateway skeleton

**Outputs:** Fastify service, config system, error envelope plumbing, serve `/healthz`, `/readyz`, `/version`.

### Phase 03 — Upstream auth + rate-limit core

**Outputs:** OAuth client_credentials (taxpayer + intermediary `onbehalfof`), token cache (~3600s), retry/backoff, per-endpoint RPM limiter. ([MyInvois SDK][3])

### Phase 04 — Submit Documents orchestration

**Outputs:** `/v1/submissions` with hashing/base64, size constraints, duplicate submission handling, persistence. ([MyInvois SDK][4])

### Phase 05 — Polling worker + submission status

**Outputs:** BullMQ worker polls Get Submission every 3–5s (bounded) and updates `/v1/submissions/{trackingId}`. ([MyInvois SDK][2])

### Phase 06 — Document state & details utilities

**Outputs:** cancel/reject endpoints; document details endpoint clearly scoped to invalid error retrieval only. ([MyInvois SDK][5])

### Phase 07 — Taxpayer utilities

**Outputs:** TIN validate endpoint (cached), idType/idValue validation. ([MyInvois SDK][6])

### Phase 08 — Observability + hardening

**Outputs:** structured logs (with correlationId), metrics, request tracing, safe redaction.

### Phase 09 — CI/CD + SDK generation PRs

**Outputs:** Spectral lint + tests + OpenAPI Generator SDKs via workflow, PR automation. ([Stoplight][7])

### Phase 10 — Docs, examples, release discipline

**Outputs:** Docker compose guide, sample client usage, SemVer tags, changelog, release checklist.

---

# Definition of Done (project-level)

* `openapi/openapi.yaml` passes Spectral (`npx @stoplight/spectral-cli lint ...`). ([Stoplight][7])
* Gateway endpoints implemented exactly as spec (request/response + error envelope).
* Worker obeys polling and anti-pattern constraints (no token-per-call; no doc APIs for submission monitoring). ([MyInvois SDK][1])
* SDKs regenerate cleanly and PR is created automatically. ([Docker Hub][8])
* OSS docs present: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, DISCLAIMER.

---

# /prompts execution pack (Claude Code Opus 4.5)

Below are the **phase prompts** you store under `/prompts/`. Each is **single-block plain text** (easy one-paste into Claude Code). Adjust repo name/org placeholders.

---

## `/prompts/promptPhase00_Bootstrap.md`

```text
You are Claude Code Opus 4.5. Implement Phase 00 (Bootstrap & Governance) for an OSS monorepo.

Repo goal:
- MyInvois Open Middleware Gateway (Node.js 20 + TypeScript)
- OpenAPI-first; SDK clients generated into /clients
- Monorepo with /apps and /packages

Tasks:
1) Initialize monorepo:
   - Use pnpm workspaces (pnpm-workspace.yaml)
   - Root package.json with scripts: lint, typecheck, test, build, dev
   - Add tsconfig.base.json and per-package tsconfigs
2) Create base structure:
   - /openapi (empty for now)
   - /apps/gateway, /apps/worker
   - /packages/core, /packages/myinvois-client, /packages/storage
   - /docker, /docs, /.github/workflows
3) Add governance files:
   - LICENSE (MIT)
   - CODE_OF_CONDUCT.md
   - CONTRIBUTING.md (how to run, how to PR, conventional commits)
   - SECURITY.md (responsible disclosure)
   - DISCLAIMER.md (unofficial OSS, no legal/tax guarantee)
4) Add tooling baseline:
   - ESLint + TypeScript ESLint
   - Prettier
   - Vitest (unit tests)
   - Husky optional (only if clean)
5) Add docker-compose skeleton:
   - postgres + redis services (no app containers yet)
6) Output a short Phase 00 completion report:
   - files created
   - commands to run locally

Constraints:
- Keep dependencies minimal
- No secrets in repo
- Ensure all scripts run even before real code exists (empty placeholders ok)

Deliverables:
- Commit-ready working repo structure
- Root README.md with “Getting Started (dev)” instructions
```

---

## `/prompts/promptPhase01_Contract_Spectral.md`

```text
You are Claude Code Opus 4.5. Implement Phase 01 (Contract-first: OpenAPI + Spectral).

Inputs:
- Use the existing OpenAPI v1 draft we designed earlier in this chat as your baseline.
- Keep the contract under /openapi/openapi.yaml.
- Add Spectral ruleset under /.spectral.yaml.

Tasks:
1) Create /openapi/openapi.yaml:
   - Include: /healthz, /readyz, /version
   - Include v1 endpoints: sessions, submissions, submission status, poll, cancel, reject, document details, tin validate
   - Ensure consistent ErrorEnvelope + GatewayError models
   - Ensure correlationId and Retry-After headers are defined in components
2) Create /.spectral.yaml:
   - Extend spectral:oas
   - Enforce: operationId required, tags required, 2xx response required
   - Enforce gateway rule: all paths must start /v1 except healthz/readyz/version
   - Enforce 429 presence on every operation
3) Add CI workflow: .github/workflows/openapi-lint.yml
   - Runs spectral lint on openapi/openapi.yaml
   - Uses actions/setup-node@v4 (Node 20)
4) Update README.md with “API Contract” section:
   - How to lint the spec locally
   - Where generated clients will go (later)

Constraints:
- Make the OpenAPI file strict and generator-friendly (avoid ambiguous schemas)
- Keep request/response examples minimal but present

Deliverables:
- Spec passes Spectral lint
- CI job runs on PR and push
- Phase 01 completion report + commands
```

---

## `/prompts/promptPhase02_Gateway_Skeleton.md`

```text
You are Claude Code Opus 4.5. Implement Phase 02 (Gateway skeleton aligned to OpenAPI).

Tasks:
1) apps/gateway:
   - Fastify server with TypeScript
   - Config via env (PORT, LOG_LEVEL, NODE_ENV)
   - Routes: /healthz, /readyz, /version implemented
2) Error handling:
   - Central error handler that outputs ErrorEnvelope + GatewayError shape
   - Always include correlationId header in responses (generate if missing)
   - Add Retry-After when applicable (not used yet)
3) Spec alignment:
   - Add a build step that validates the server routes exist for the spec paths (lightweight check ok)
4) DX:
   - pnpm dev to start gateway
   - pnpm build to produce dist
   - pnpm test includes at least one HTTP test (supertest or undici)

Constraints:
- No upstream MyInvois calls yet
- Keep deps minimal and fastify-native

Deliverables:
- Gateway runs locally
- Health endpoints match OpenAPI responses exactly
- Phase 02 completion report
```

---

## `/prompts/promptPhase03_MyinvoisClient_Auth_Ratelimit.md`

```text
You are Claude Code Opus 4.5. Implement Phase 03 (Upstream client: auth + rate-limit core).

Authoritative MyInvois rules to implement:
- OAuth client_credentials via POST /connect/token
- expires_in is seconds; default 3600; cache token for lifetime
- Intermediary login requires header "onbehalfof" = TIN or TIN:ROB
- Recommended RPM: Login endpoints 12 RPM/clientId
- Avoid frequent login attempts; implement exponential backoff
- All subsequent calls use Authorization: Bearer <token>

Tasks:
1) packages/myinvois-client:
   - Implement TokenManager:
     - getToken(session): cached token by (env, mode, clientId, onBehalfOf)
     - refresh on 401
     - respects expires_in
   - Implement RateLimiter:
     - token endpoint: 12 RPM per clientId
     - store counts per minute in-memory (Phase 03) with interface for Redis later
2) Session model:
   - Implement in packages/core: SessionCreate logic (env/mode/clientId/secret/onBehalfOf)
   - Do NOT persist clientSecret by default; store in-memory only unless explicitly enabled
3) Gateway endpoints:
   - Implement POST /v1/sessions:
     - validates request
     - tests auth call to upstream (optional toggle: VALIDATE_UPSTREAM=true)
     - returns sessionId without secrets
   - Implement GET/DELETE session endpoints (metadata only)
4) Security:
   - redact secrets from logs
   - enforce HTTPS recommendation in docs (runtime does not enforce in dev)

Deliverables:
- Unit tests for TokenManager caching + refresh
- Integration test stubs (no real upstream required)
- Phase 03 completion report
```

---

## `/prompts/promptPhase04_SubmitDocuments.md`

```text
You are Claude Code Opus 4.5. Implement Phase 04 (Submit Documents orchestration).

Authoritative MyInvois rules to implement:
- Submit Documents endpoint: POST /api/v1.0/documentsubmissions/
- Recommended RPM: 100 RPM/clientId
- Gateway must support raw doc input OR prepared base64+sha256 fields
- Enforce submission constraints:
  - max 100 documents per submission
  - gateway should enforce total submission size policy; fail fast if exceeded
- Handle DuplicateSubmission:
  - if upstream returns 422 duplicate, surface retryAfterSeconds (Retry-After header) and stable error envelope

Tasks:
1) packages/core:
   - hashing helper: SHA-256
   - base64 helper
   - optional minify helper for JSON/XML (safe whitespace trimming)
   - estimate payload sizes
2) packages/storage:
   - Prisma schema for:
     - Session (metadata only)
     - Submission (trackingId, submissionUid, status, timestamps)
     - Document (trackingId, codeNumber, uuid, status, lastError)
   - Support Postgres (prod) and SQLite (dev) via config
3) apps/gateway:
   - Implement POST /v1/submissions:
     - validates sessionId exists
     - prepares docs, calls upstream submit
     - stores submission + docs
     - returns 202 with trackingId + submissionUid + accepted/rejected arrays
     - schedules polling job when asyncPolling=true (worker in Phase 05)
4) Rate limiting:
   - Add per-endpoint limiter for submit: 100 RPM/clientId
5) Tests:
   - unit tests for hashing/base64
   - integration tests with mocked upstream responses including 422 duplicate with Retry-After

Deliverables:
- Endpoint matches OpenAPI exactly
- Prisma migrations included
- Phase 04 completion report
```

---

## `/prompts/promptPhase05_PollingWorker_GetSubmission.md`

```text
You are Claude Code Opus 4.5. Implement Phase 05 (Polling worker + Get Submission status).

Authoritative MyInvois rules:
- Use Get Submission API to monitor submission/doc status
- Polling interval 3–5 seconds recommended; avoid throttling
- Max 300 RPM/clientId for Get Submission
- Do NOT monitor submission by calling Get Document / Details / Search / Recent

Tasks:
1) apps/worker:
   - BullMQ worker using Redis
   - Job type: POLL_SUBMISSION(trackingId)
   - Poll interval configurable but enforce minimum 3 seconds
   - Rate limiter: 300 RPM/clientId
   - Stop polling when terminal status reached (VALID/INVALID) OR timeout window reached
2) packages/myinvois-client:
   - Implement getSubmission(submissionUid)
3) packages/storage:
   - Update submission/document records from upstream result
4) apps/gateway:
   - Implement GET /v1/submissions/{trackingId}
   - Implement POST /v1/submissions/{trackingId}/poll:
     - triggers one immediate poll run if allowed
     - if too soon, return 409 with Retry-After seconds
5) Tests:
   - worker unit tests (with BullMQ test mode)
   - rate limiter tests
6) Docker:
   - Update docker-compose to optionally run gateway + worker

Deliverables:
- End-to-end local flow (with mocked upstream) demonstrating:
  submit -> background polling -> status updates
- Phase 05 completion report
```

---

## `/prompts/promptPhase06_DocumentState_Details.md`

```text
You are Claude Code Opus 4.5. Implement Phase 06 (Document state + details).

Authoritative MyInvois rules:
- Cancel/Reject use document state change API (upstream)
- Recommended RPM: Cancel 12, Reject 12
- Get Document Details should be used only for retrieving error details for invalid docs; do not use it for status monitoring

Tasks:
1) packages/myinvois-client:
   - implement changeDocumentState(uuid, state, reason)
   - implement getDocumentDetails(uuid) (optional proxy)
2) apps/gateway:
   - POST /v1/documents/{uuid}/cancel
   - POST /v1/documents/{uuid}/reject
   - GET /v1/documents/{uuid}/details
   - Ensure ErrorEnvelope consistency + correlationId handling
3) Rate limiting:
   - enforce 12 RPM/clientId for cancel/reject
4) Docs:
   - add docs note: details endpoint intended only for invalid/error retrieval

Deliverables:
- Endpoints match OpenAPI
- Tests for state changes and rate limiting
- Phase 06 completion report
```

---

## `/prompts/promptPhase07_TIN_Validate_Cache.md`

```text
You are Claude Code Opus 4.5. Implement Phase 07 (Validate Taxpayer TIN with caching).

Authoritative MyInvois rules:
- Validate TIN endpoint signature: GET /api/v1.0/taxpayer/validate/{tin}?idType={idType}&idValue={idValue}
- When logged in as intermediary, permissions apply

Tasks:
1) packages/myinvois-client:
   - implement validateTin(tin, idType, idValue)
2) packages/core:
   - caching interface (in-memory now; Redis option later)
   - cache positive validations with TTL
3) apps/gateway:
   - GET /v1/tin/validate?sessionId=&tin=&idType=&idValue=
   - Return TinValidateResponse exactly
4) Tests:
   - caching behavior
   - invalid inputs

Deliverables:
- Endpoint works with mocked upstream
- Phase 07 completion report
```

---

## `/prompts/promptPhase08_Observability_Hardening.md`

```text
You are Claude Code Opus 4.5. Implement Phase 08 (Observability + hardening).

Tasks:
1) Logging:
   - structured JSON logs
   - always include correlationId in log context
   - redact secrets/session sensitive fields
2) Metrics:
   - expose /metrics (Prometheus format) OR minimal counters
   - track: upstream calls, 429 counts, retry counts, polling cycles, terminal statuses
3) Reliability:
   - centralized retry policy:
     - handle 429 Retry-After
     - exponential backoff on auth failures
   - safe timeouts for upstream calls
4) Docs:
   - troubleshooting guide: “how to use correlationId”, “common throttling causes”, “polling rules”

Deliverables:
- Metrics endpoint + sample dashboard notes
- Phase 08 completion report
```

---

## `/prompts/promptPhase09_CI_SDK_Generation.md`

```text
You are Claude Code Opus 4.5. Implement Phase 09 (CI + SDK generation PR workflow).

Tasks:
1) Add GitHub Actions:
   - openapi lint workflow (Spectral)
   - test workflow (lint/typecheck/unit tests)
2) Add SDK generation workflow (main branch only):
   - Use openapitools/openapi-generator-cli docker image
   - Generate:
     - clients/typescript-axios
     - clients/python
     - clients/csharp
     - clients/java (okhttp-gson)
   - Open a PR with regenerated outputs using peter-evans/create-pull-request
3) Add language-specific generator configs if needed to reduce diff churn.
4) Update README with:
   - how clients are generated
   - how to consume TS client (example)

Constraints:
- Avoid infinite PR loop (generation runs only on push to main)
- Keep generated docs/tests disabled in generator options (minimize noise)

Deliverables:
- CI green on PR
- Auto PR appears on main push with updated clients
- Phase 09 completion report
```

---

## `/prompts/promptPhase10_Docs_Examples_Releases.md`

```text
You are Claude Code Opus 4.5. Implement Phase 10 (Docs, examples, releases).

Tasks:
1) /docs:
   - integration-guide.md (how to run gateway + worker)
   - upstream behavior notes:
     - token caching ~60 minutes
     - Get Submission polling 3–5 seconds
     - anti-patterns: no token-per-call; no document APIs for monitoring
   - troubleshooting.md (429 handling, Retry-After, correlationId)
2) /examples:
   - node example using generated TS client
   - python example
   - dotnet example
   - java example
3) Release discipline:
   - CHANGELOG.md
   - SemVer policy
   - Release checklist (tag, generate clients, publish docs)

Deliverables:
- Clean OSS landing README
- Examples runnable
- Phase 10 completion report

[1]: https://sdk.myinvois.hasil.gov.my/integration-practices/ "Integration Practices"
[2]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/06-get-submission/ "Get Submission"
[3]: https://sdk.myinvois.hasil.gov.my/api/08-login-as-intermediary-system/ "Login as Intermediary System"
[4]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/02-submit-documents/ "Submit Documents"
[5]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/08-get-document-details/ "Get Document Details"
[6]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/01-validate-taxpayer-tin/ "Validate Taxpayer's TIN"
[7]: https://docs.stoplight.io/docs/spectral/9ffa04e052cc1-spectral-cli?utm_source=chatgpt.com "Spectral CLI"
[8]: https://hub.docker.com/r/openapitools/openapi-generator-cli/tags?utm_source=chatgpt.com "openapitools/openapi-generator-cli - Docker Image"
