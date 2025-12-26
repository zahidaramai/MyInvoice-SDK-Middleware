Key MyInvois constraints Phase 03 must bake in (from official SDK):

* **Token lifetime + caching:** cache access tokens for their lifetime (default **60 minutes**), and **do not** request a new token per API call. ([MyInvois SDK][1])
* **Intermediary auth:** same `POST /connect/token`, but intermediary **must** send `onbehalfof` header (TIN or `TIN:ROB`). ([MyInvois SDK][2])
* **Rate limits (RPM / Client ID):** Login 12 (taxpayer+intermediary), Submit 100, Get Submission 300, Cancel/Reject 12, etc. ([MyInvois SDK][1])
* **Environment base URLs:** PROD `api.myinvois.hasil.gov.my`, SANDBOX `preprod-api.myinvois.hasil.gov.my` (both System API + Identity Service). ([MyInvois SDK][3])
* **Headers:** authenticated calls use `Authorization: Bearer <token>`; responses include `correlationId` and rate-limit headers. ([MyInvois SDK][4])

```text
PROMPT FILE: /prompts/promptPhase03_Auth_Ratelimit_Sessions.md
TARGET MODEL: Claude Code Opus 4.5
PHASE: 03 — Upstream Auth + Rate-Limit Core + Sessions (Gateway)

========================
0) SHORT PRD (PHASE 03)
========================
Goal:
- Implement a robust MyInvois upstream client foundation:
  (1) OAuth2 client_credentials login (/connect/token) for TAXPAYER + INTERMEDIARY
  (2) token caching for token lifetime (default ~60 minutes)
  (3) in-memory rate limiter aligned to MyInvois recommended RPM
  (4) gateway session management endpoints aligned to OpenAPI v1

Why:
- MyInvois integration becomes “tedious” mostly due to auth renewal, rate limits, and bad retry patterns.
- Phase 03 establishes a safe, reusable client layer and a clean gateway abstraction for downstream phases.

Success criteria:
- packages/myinvois-client exposes TokenManager + MyInvoisHttpClient that:
  - caches tokens by session
  - refreshes on 401
  - applies rate-limiting guards per endpoint category
- apps/gateway implements:
  - POST /v1/sessions
  - GET /v1/sessions/{sessionId}
  - DELETE /v1/sessions/{sessionId}
- No secrets are persisted by default (memory-only secrets, short session TTL)
- Tests cover token caching, intermediary header, and limiter behavior
- All repo scripts pass: lint/typecheck/test/build

In-scope:
- MyInvois identity login implementation
- Session store (memory) + session metadata (sanitized)
- Rate limiter interface + in-memory impl
- Upstream HTTP wrapper that captures upstream correlationId and rate-limit headers
- Gateway endpoints for session lifecycle

Out-of-scope:
- Submit Documents orchestration (Phase 04)
- Polling worker (Phase 05)
- DB persistence (may be introduced later; Phase 03 uses memory store only)

========================
1) AUTHORITATIVE BEHAVIOR (MUST IMPLEMENT)
========================
A) Environments (base URLs)
- PROD:
  - Identity Service base: https://api.myinvois.hasil.gov.my
  - System API base:      https://api.myinvois.hasil.gov.my
- SANDBOX (Pre-Prod):
  - Identity Service base: https://preprod-api.myinvois.hasil.gov.my
  - System API base:      https://preprod-api.myinvois.hasil.gov.my

B) Login endpoint
- Signature: POST /connect/token
- Body (x-www-form-urlencoded):
  - client_id (required)
  - client_secret (required)
  - grant_type=client_credentials (required)
  - scope=InvoicingAPI (optional; can be omitted)
- Intermediary login requires header:
  - onbehalfof: either taxpayer TIN OR "TIN:ROB"
- Token response includes:
  - access_token
  - token_type=Bearer
  - expires_in seconds (commonly 3600)
- Rate limit recommended: 12 RPM / Client ID for login.

C) Anti-pattern to prevent
- Do NOT acquire a new token on every API call.
- Cache tokens for lifetime and renew only when needed.
- If login fails, do not hammer the login endpoint; backoff and surface a clear error.

D) Standard headers to observe
- Authenticated call uses Authorization: Bearer <token>
- Upstream responds with correlationId and rate-limit headers (X-Rate-Limit-*).
- Capture them for logs and error diagnostics.

========================
2) AGENT RULES
========================
- Do NOT change OpenAPI contract unless it is invalid.
- Do NOT persist client_secret or tokens to disk/db by default.
- All secrets must be redacted from logs.
- Implement everything as reusable, small modules (no monolith file).
- Prefer Node 20+ native fetch; do not add axios unless required.
- Any retry must obey rate limits and exponential backoff on auth failures.
- Always return gateway ErrorEnvelope format for errors in session endpoints.

========================
3) DEFINITION OF DONE (DoD)
========================
[ ] pnpm -r lint passes
[ ] pnpm -r typecheck passes
[ ] pnpm -r test passes
[ ] pnpm -r build passes
[ ] POST /v1/sessions creates an in-memory session and returns sanitized metadata (no secrets)
[ ] Session mode rules:
    - TAXPAYER: onBehalfOf forbidden/ignored
    - INTERMEDIARY: onBehalfOf required and validated (TIN or TIN:ROB)
[ ] TokenManager:
    - caches token until expiry
    - refreshes token when near-expiry (configurable skew) OR on upstream 401
    - enforces login 12 RPM per clientId
[ ] Rate limiter is generic (can be swapped with Redis later)
[ ] Unit tests cover:
    - token caching hit (same token reused)
    - refresh on expired token
    - intermediary sends onbehalfof header
    - limiter rejects after N calls/minute and returns retryAfterSeconds
[ ] Gateway always returns correlationId header and ErrorEnvelope on failures

========================
4) DELIVERABLES (FILES)
========================
Update/create:

/packages/core/src/
  - env.ts (env enums + url resolution)
  - rateLimit/
      - types.ts
      - inMemoryLimiter.ts
  - crypto/
      - redact.ts (redaction helpers)
      - stableHash.ts (sha256 for fingerprints)
  - time.ts (now(), ms helpers)

/packages/myinvois-client/src/
  - types.ts (session, token, upstream meta)
  - identity.ts (login request builder)
  - tokenManager.ts
  - httpClient.ts (request wrapper)
  - rateLimits.ts (recommended RPM map)
  - index.ts

/apps/gateway/src/
  - routes/v1/sessions.ts
  - lib/sessionStore.ts (in-memory store + TTL)
  - lib/myinvois.ts (wiring myinvois-client into gateway)
  - app.ts (register sessions route)
  - tests updated/added:
      - sessions.test.ts
      - tokenManager.test.ts (or in package tests)

/apps/gateway/.env.example (no real secrets; document variables)

========================
5) PUBLIC CONTRACT (SESSION ENDPOINTS)
========================
Implement per OpenAPI:

POST /v1/sessions
- request: SessionCreateRequest (oneOf TAXPAYER vs INTERMEDIARY)
- response 201: SessionResponse (sanitized)
- error 400/401/403/429/500: ErrorEnvelope

GET /v1/sessions/{sessionId}
- response 200: SessionResponse

DELETE /v1/sessions/{sessionId}
- response 204

SessionResponse MUST NOT include:
- clientSecret
- access_token

Optional:
- include tokenExpiresAt (timestamp) if spec allows and it does not leak token value.

========================
6) IMPLEMENTATION STEPS (EXECUTION PLAN)
========================
Step A — Environment + URL resolution
1) packages/core/env.ts:
   - enum Env: PROD | SANDBOX
   - resolveIdentityBaseUrl(env): https://api... or https://preprod-api...
   - resolveSystemBaseUrl(env): same

Step B — Rate limiter (generic)
2) packages/core/rateLimit/types.ts:
   - interface RateLimiter { consume(key, limitPerMinute): { allowed, retryAfterSeconds } }
3) packages/core/rateLimit/inMemoryLimiter.ts:
   - token bucket or fixed window per minute (good enough)
   - must return retryAfterSeconds for denied calls

Step C — MyInvois client: identity login + token caching
4) packages/myinvois-client/identity.ts:
   - function login(session): POST {identityBaseUrl}/connect/token
   - content-type: application/x-www-form-urlencoded
   - includes onbehalfof header ONLY for INTERMEDIARY sessions
5) tokenManager.ts:
   - cache key by sessionId (or session fingerprint)
   - store { accessToken, expiresAt }
   - apply skew (e.g. renew if expiresAt - now < 30s)
   - on login failures: apply exponential backoff (store nextAllowedLoginAt per session)
   - use RateLimiter consume with login limit 12 RPM/clientId
6) httpClient.ts:
   - request(session, { method, url, authRequired, headers, body })
   - if authRequired -> getToken() then set Authorization: Bearer ...
   - capture upstream headers:
     - correlationId
     - X-Rate-Limit-Limit/Remaining/Reset (if present)
   - if 401 and authRequired:
     - force refresh token once and retry once
   - if 429:
     - surface a typed UpstreamRateLimitError including retryAfterSeconds derived from:
       - Retry-After header if present, else X-Rate-Limit-Reset delta if present, else default 60

Step D — Session store (gateway-local, memory only)
7) apps/gateway/lib/sessionStore.ts:
   - Map sessionId -> session object (contains secrets in memory only)
   - TTL default 24h (config SESSION_TTL_MS)
   - store:
     - sessionId
     - env, mode
     - clientId
     - clientSecret (memory only)
     - scope (optional)
     - onBehalfOf (only for intermediary)
     - createdAt, lastUsedAt
     - fingerprint (sha256 of env+mode+clientId+onBehalfOf) for logs
   - purge interval (simple setInterval)

Step E — Gateway sessions routes
8) apps/gateway/routes/v1/sessions.ts:
   - POST /v1/sessions:
     - validate inputs strictly:
       - env in {PROD,SANDBOX}
       - mode in {TAXPAYER,INTERMEDIARY}
       - clientId non-empty
       - clientSecret non-empty
       - intermediary requires onBehalfOf (TIN or TIN:ROB)
     - create sessionId (uuid)
     - optionally validate upstream login if env VALIDATE_UPSTREAM=true:
       - call TokenManager.getToken(session) (respects rate limit)
       - on error, delete session and return ErrorEnvelope
     - return 201 SessionResponse (no secrets)
   - GET /v1/sessions/:sessionId:
     - if missing -> 404 ErrorEnvelope
     - return sanitized metadata
   - DELETE /v1/sessions/:sessionId:
     - delete session, best-effort clear token cache
     - return 204

9) apps/gateway/app.ts:
   - register sessions routes and keep existing Phase 02 behavior

Step F — Tests
10) TokenManager tests (in packages/myinvois-client or apps/gateway):
   - mock global fetch:
     - success response with expires_in
     - verify 2 calls reuse cached token
     - simulate 401 then refresh
     - verify intermediary includes onbehalfof header
11) Sessions route tests (fastify.inject):
   - create session returns 201 + correlationId header
   - intermediary missing onbehalfof returns 400 ErrorEnvelope
   - get/delete session works
12) Limiter tests:
   - consume beyond limit returns retryAfterSeconds > 0

Step G — Docs + env example
13) apps/gateway/.env.example:
   - PORT, LOG_LEVEL, NODE_ENV
   - VALIDATE_UPSTREAM=false
   - SESSION_TTL_MS=86400000
   - TOKEN_RENEW_SKEW_MS=30000

========================
7) ACCEPTANCE TESTS (MUST RUN)
========================
- pnpm -r typecheck
- pnpm -r lint
- pnpm -r test
- pnpm -r build
- pnpm --filter @myinvois/gateway dev
Manual smoke:
- POST /v1/sessions (VALIDATE_UPSTREAM=false) => 201 + correlationId header

========================
8) COMPLETION REPORT FORMAT (MANDATORY)
========================
At the end, output:
- Files created/updated (grouped by package/app)
- How token caching works (cache key, expiry, skew)
- How intermediary header is handled and validated
- Rate-limit logic + retryAfter derivation
- Exact commands to run
- Phase 04 readiness notes (what’s now available to call Submit Documents)

========================
NOW EXECUTE PHASE 03
========================
Implement the above across packages/core, packages/myinvois-client, and apps/gateway. Keep diffs minimal where Phase 02 code exists. Ensure all scripts pass.
```

[1]: https://sdk.myinvois.hasil.gov.my/integration-practices/ "Integration Practices"
[2]: https://sdk.myinvois.hasil.gov.my/api/08-login-as-intermediary-system/ "Login as Intermediary System"
[3]: https://sdk.myinvois.hasil.gov.my/faq/ "Frequently Asked Questions"
[4]: https://sdk.myinvois.hasil.gov.my/standard-header-parameters/ "Standard Header Parameters"
