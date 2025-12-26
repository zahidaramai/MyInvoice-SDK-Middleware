Phase 01 will lock the **API contract as the product** and enforce it with Spectral linting in CI. We’ll keep **OpenAPI 3.0.3** for maximum generator/tool compatibility, and **avoid JSON Schema conditionals (`if/then`)** because OpenAPI 3.0 uses a limited JSON Schema subset (not all keywords are supported). ([OpenAPI Initiative Publications][1]) Spectral will run via its CLI with a repo ruleset. ([Stoplight][2]) GitHub Actions will use `actions/setup-node@v4` for consistent Node setup (and optional caching later). ([GitHub][3])

```text
PROMPT FILE: /prompts/promptPhase01_Contract_Spectral.md
TARGET MODEL: Claude Code Opus 4.5
PHASE: 01 — Contract-First (OpenAPI v1 + Spectral + CI)

========================
0) SHORT PRD (PHASE 01)
========================
Goal:
- Lock OpenAPI v1 contract for the gateway as the single source of truth.
- Add Spectral linting (custom ruleset) and CI enforcement.
- Ensure spec is generator-friendly and avoids unsupported OpenAPI 3.0 schema keywords.

Why:
- OpenAPI 3.0 uses a subset of JSON Schema; conditional keywords like if/then are not reliably supported by OAS 3.0 tooling.
- Spectral gives deterministic style + quality gates on every PR.

Success criteria:
- openapi/openapi.yaml exists and is valid OpenAPI 3.0.3
- .spectral.yaml exists and lints openapi/openapi.yaml cleanly
- CI runs Spectral lint on PR + push to main
- README updated with “API Contract” section and local lint commands

In-scope:
- openapi/openapi.yaml (full v1 draft)
- .spectral.yaml (gateway policy rules)
- .github/workflows/openapi-lint.yml (CI)
- README updates

Out-of-scope:
- server implementation (Phase 02)
- upstream MyInvois client (Phase 03)
- SDK generation workflow (Phase 09)

========================
1) AGENT RULES
========================
- Do NOT ask questions; assume Phase 00 structure exists.
- Keep OpenAPI version at 3.0.3 for widest tool support.
- Do NOT use JSON Schema conditional keywords (if/then/else/dependentSchemas) in OAS 3.0 spec.
- Prefer oneOf + discriminator patterns for conditional payloads.
- Spec must be consistent, minimal, and stable to reduce diff churn.
- Errors must use a stable envelope: { error: GatewayError } everywhere.
- Any breaking contract change must be explicit and documented (but Phase 01 is initial contract).

========================
2) DEFINITION OF DONE (DoD)
========================
[ ] openapi/openapi.yaml passes: npx @stoplight/spectral-cli lint openapi/openapi.yaml --ruleset .spectral.yaml
[ ] CI openapi-lint workflow runs on PR + push and passes
[ ] OpenAPI is generator-friendly:
    - unique operationId for every operation
    - consistent tags
    - consistent 2xx responses
    - no unsupported schema keywords for OAS 3.0
[ ] README documents:
    - where spec lives
    - how to lint locally
    - contract governance rules (OpenAPI is source of truth)

========================
3) DELIVERABLES
========================
Create/update:

/openapi/openapi.yaml
/.spectral.yaml
/.github/workflows/openapi-lint.yml
/README.md (add API Contract section)

Optional (only if helpful, keep minimal):
/docs/api-contract.md

========================
4) ENDPOINT SCOPE (MUST MATCH v1 DRAFT)
========================
Non-versioned:
- GET /healthz
- GET /readyz
- GET /version

Versioned (/v1):
Sessions:
- POST /v1/sessions
- GET /v1/sessions/{sessionId}
- DELETE /v1/sessions/{sessionId}

Submissions:
- POST /v1/submissions
- GET /v1/submissions/{trackingId}
- POST /v1/submissions/{trackingId}/poll

Documents:
- POST /v1/documents/{uuid}/cancel
- POST /v1/documents/{uuid}/reject
- GET /v1/documents/{uuid}/details

Taxpayer:
- GET /v1/tin/validate

========================
5) CONTRACT RULES (IMPORTANT)
========================
A) OpenAPI 3.0.3 schema rules:
- Do not use if/then/else or other JSON Schema draft-07+ features.
- Use oneOf + discriminator instead.
- If a conditional requirement is needed (e.g. onBehalfOf required for INTERMEDIARY),
  implement as oneOf with discriminator on "mode" or split schemas:
  - SessionCreateTaxpayer
  - SessionCreateIntermediary (requires onBehalfOf)
  And reference them via oneOf in SessionCreateRequest.

B) Error model:
- ErrorEnvelope MUST be:
  { "error": GatewayError }
- GatewayError MUST require:
  - httpStatus
  - messageEN
- Always define correlationId header in responses
- Define Retry-After header component and include it in 429 and relevant responses

C) Rate-limit policy at contract level:
- Every operation MUST define a 429 response (even if server implementation comes later).

========================
6) IMPLEMENTATION STEPS
========================
Step A — Create openapi/openapi.yaml
1) Add full OpenAPI spec under /openapi/openapi.yaml with:
   - openapi: 3.0.3
   - info: title, version (0.1.0), description
   - servers: localhost + placeholder production
   - tags with descriptions

2) Fix conditional schema patterns:
   - Replace any if/then usage with oneOf/discriminator.
   - SessionCreateRequest should be oneOf:
     - SessionCreateTaxpayer: mode=TAXPAYER, no onBehalfOf
     - SessionCreateIntermediary: mode=INTERMEDIARY, requires onBehalfOf

3) Ensure spec is strict:
   - operationId for every endpoint
   - responses include at least one 2xx
   - define standard error component responses:
     - BadRequest, Unauthorized, Forbidden, NotFound, TooManyRequests, InternalError

4) Ensure every operation defines 429 response.

Step B — Create .spectral.yaml
1) Extend spectral:oas
2) Enforce:
   - operationId required (error)
   - tags required (error)
   - 2xx response required (error)
   - all paths under /v1 except /healthz /readyz /version (error)
   - each operation must define 429 (error)
   - TooManyRequests must define Retry-After header (error)
   - ErrorEnvelope schema must remain { error: GatewayError } (error)

Step C — Add CI workflow: openapi-lint
1) Create .github/workflows/openapi-lint.yml:
   - trigger on pull_request and push to main when openapi/** or .spectral.yaml changes
   - steps:
     - actions/checkout@v4
     - actions/setup-node@v4 (Node 20 or 22)
     - run: npx --yes @stoplight/spectral-cli lint openapi/openapi.yaml --ruleset .spectral.yaml

2) If Phase 00 already has ci.yml, do NOT break it; openapi-lint is separate.

Step D — Update README
1) Add “API Contract” section:
   - path: openapi/openapi.yaml
   - local lint command
   - contribution rule: contract changes require spec lint passing and (later) SDK regen

========================
7) ACCEPTANCE TESTS (MUST RUN)
========================
- npx --yes @stoplight/spectral-cli lint openapi/openapi.yaml --ruleset .spectral.yaml
- (optional) validate OpenAPI file loads in Swagger Editor / Redoc locally (no need to commit tooling)

========================
8) COMPLETION REPORT FORMAT (MANDATORY)
========================
At the end, output:
- Files created/updated (grouped: OpenAPI, Spectral, CI, Docs)
- Notable design decisions:
  - why OAS 3.0.3
  - how conditional requirements implemented (oneOf/discriminator)
- Exact commands to run locally
- Follow-ups for Phase 02

========================
NOW EXECUTE PHASE 01
========================
Implement the full contract and CI rules above. If openapi/openapi.yaml already exists, update it to comply (remove unsupported schema keywords) with minimal diff while keeping the endpoint surface identical.
```

[1]: https://spec.openapis.org/oas/v3.0.3.html?utm_source=chatgpt.com "OpenAPI Specification v3.0.3"
[2]: https://docs.stoplight.io/docs/spectral/9ffa04e052cc1-spectral-cli?utm_source=chatgpt.com "Spectral CLI"
[3]: https://github.com/actions/setup-node?utm_source=chatgpt.com "actions/setup-node"
