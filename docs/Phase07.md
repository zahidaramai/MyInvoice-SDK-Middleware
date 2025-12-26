Phase 07 should cover **Taxpayer identity utilities** that MyInvois explicitly expects ERP/middleware to implement safely:

* **Validate TIN** upstream signature is `GET /api/v1.0/taxpayer/validate/{tin}?idType={idType}&idValue={idValue}` with `200` when valid and `404` when the TIN+ID combination is invalid/not found. ([MyInvois SDK][1])
* MyInvois explicitly warns: **cache these results** and **do not call before every submission**, or you may be throttled/flagged as malicious. ([MyInvois SDK][1])
* **Search Taxpayer’s TIN** exists and has a recommended **60 RPM** rate limit, and also recommends caching. ([MyInvois SDK][2])
* If rate limits are exceeded, MyInvois returns `429 TooManyRequests` with a **`Retry-After` (seconds)** header; also correlationId is returned in headers for tracing. ([MyInvois SDK][3])

```text
PHASE 07 — EXECUTION PROMPT (Claude Code Opus 4.5)
Project: MyInvois Middleware Gateway (OpenAPI-first, Node/TS, OSS)

MISSION
Implement Taxpayer TIN utilities (Validate + optional Search) with:
- strict input validation + normalization
- privacy-safe caching (no raw NRIC/passport persisted)
- rate limiting + correct 429 Retry-After propagation
- consistent error mapping + correlationId handling
- full tests (mocked upstream)

SOURCE OF TRUTH (do NOT paste large excerpts; implement behavior)
1) Validate Taxpayer’s TIN:
   GET /api/v1.0/taxpayer/validate/{tin}?idType={idType}&idValue={idValue}
   - 200 if valid
   - 404 if TIN + ID combination invalid/not found
   - guidance: cache results; do not call before every submission; excessive requests may be throttled/flagged
2) Search Taxpayer’s TIN (OPTIONAL; implement only if in our OpenAPI spec):
   GET /api/v1.0/taxpayer/search/tin?idType={idType}&idValue={idValue}&taxpayerName={taxpayerName}&fileType={fileType}
   - 200 returns one TIN
   - 404 if none
   - 400 if search not conclusive (>1 match) OR invalid parameters
   - recommended rate limit: 60 RPM
   - guidance: cache results; do not call before every submission
3) Rate limiting semantics:
   - 429 includes Retry-After (seconds)
4) Standard headers:
   - Authorization: Bearer <token>
   - Response includes correlationId, and may include X-Rate-Limit-* headers

SCOPE (WHAT YOU MUST SHIP)
A) packages/myinvois-client
   - validateTaxpayerTin()
   - searchTaxpayerTin() (only if spec includes it; otherwise skip and leave stub)
   - normalize errors (400/404/429) with retryAfterSeconds and correlationId capture
B) packages/storage
   - Add privacy-safe cache tables for TIN validation/search results (hashed ID values)
   - Repository methods for cache read/write with expiry
C) apps/gateway
   - Implement endpoints per OpenAPI:
     - GET /v1/taxpayer/tin/validate (or spec equivalent)
     - GET /v1/taxpayer/tin/search  (only if spec includes it)
   - Add cache behavior:
     - serve HIT without upstream call
     - expose lightweight cache telemetry headers (X-Cache: HIT|MISS, X-Cache-TTL)
   - Enforce rate limits before upstream call; return 429 + Retry-After from limiter
D) Tests
   - unit + route tests with mocked upstream
   - privacy assertions: DB must not store raw idValue / taxpayerName in cleartext (only hashes)

NON-GOALS
- Persisting or syncing “buyer master data” (ERP responsibility)
- Any UI, backoffice screens, or manual workflows
- Bulk validation jobs (can be Phase 08 if needed)

SECURITY / PRIVACY RULES (NON-NEGOTIABLE)
1) Do NOT store raw idValue (NRIC/passport/army) or taxpayerName in DB.
2) Cache keys must be based on:
   - env, clientId/sessionId, tin, idType, SHA256(idValue + SALT), and optionally SHA256(taxpayerName + SALT)
3) SALT must come from env var (e.g., CACHE_HASH_SALT) and never logged.
4) Logs must not include idValue/taxpayerName; log only hashes + tracking identifiers.

CONFIG (ENV VARS)
- CACHE_HASH_SALT=...
- TIN_VALIDATE_CACHE_TTL_DAYS_VALID=180
- TIN_VALIDATE_CACHE_TTL_DAYS_INVALID=7
- TIN_SEARCH_CACHE_TTL_DAYS_FOUND=30
- TIN_SEARCH_CACHE_TTL_DAYS_NOT_FOUND=7
- TIN_VALIDATE_RPM=60      (project decision; conservative due to throttling warning)
- TIN_SEARCH_RPM=60        (matches upstream recommendation)

DELIVERABLES (FILES/CHANGES)
1) packages/myinvois-client
   - src/taxpayer/validateTin.ts
     fn validateTaxpayerTin(session, { tin, idType, idValue }) -> { valid: true, correlationId }
       - 200 => valid true
       - 404 => valid false (but prefer to throw NotFound? align to gateway contract)
       - 400 => BadArgument error
       - 429 => RateLimit error with retryAfterSeconds
   - src/taxpayer/searchTin.ts  (optional)
     fn searchTaxpayerTin(session, { idType?, idValue?, taxpayerName?, fileType? }) -> { tin, correlationId }
   - src/errors/myinvoisErrors.ts
     - ensure standardized typed errors: BadArgument(400), NotFound(404), TooManyRequests(429 with Retry-After), Forbidden(403)
     - always capture response correlationId header if present
   - src/index.ts exports

2) packages/storage (Prisma)
   - prisma/schema.prisma add:
     model TinValidateCache {
       id                String   @id @default(uuid())
       env               String
       sessionId         String   // or clientId if available
       tin               String
       idType            String
       idValueHash       String
       result            String   // "VALID" | "INVALID"
       validatedAt       DateTime @default(now())
       expiresAt         DateTime
       correlationId     String?
       @@index([env, sessionId, tin, idType, idValueHash])
       @@unique([env, sessionId, tin, idType, idValueHash])
     }

     model TinSearchCache {  (optional)
       id                String   @id @default(uuid())
       env               String
       sessionId         String
       idType            String?
       idValueHash       String?
       taxpayerNameHash  String?
       fileType          Int?
       resultTin         String?  // null => NOT_FOUND cached
       searchedAt        DateTime @default(now())
       expiresAt         DateTime
       correlationId     String?
       @@index([env, sessionId, idType, idValueHash, taxpayerNameHash, fileType])
     }

   - src/repositories/tinRepo.ts
     - getValidateCache(...)
     - setValidateCache(...)
     - getSearchCache(...) (optional)
     - setSearchCache(...) (optional)
     - ensure “expired rows ignored”
   - Add migration

3) apps/gateway
   - src/routes/v1/taxpayerTin.ts
     Routes:
     a) GET /v1/taxpayer/tin/validate
        Inputs (align to OpenAPI):
          - sessionId (header or query as per your spec)
          - tin (path or query depending on spec)
          - idType, idValue
          - optional forceRefresh=1
        Flow:
          1) validate inputs; normalize:
             - idType uppercased and trimmed
             - tin trimmed
             - idValue trimmed
          2) compute idValueHash = sha256(idValue + SALT)
          3) check DB cache (only if !forceRefresh):
             - if HIT and not expired:
               - return 200 with cached result (valid true/false depending on contract)
               - set X-Cache=HIT; X-Cache-TTL=<seconds>
          4) enforce rate limit (TIN_VALIDATE_RPM) using existing limiter:
             - if exceeded => 429 + Retry-After, no upstream call
          5) call myinvoisClient.validateTaxpayerTin(...)
             - on 200 => store VALID cache with TTL valid-days
             - on 404 => store INVALID cache with TTL invalid-days
             - on 429 => forward Retry-After; do NOT cache
          6) return response per OpenAPI + correlationId header
     b) GET /v1/taxpayer/tin/search (ONLY IF SPEC EXISTS)
        Similar caching approach; hash taxpayerName + idValue if present; enforce RPM=60.

   - Ensure correlationId header is always set in responses (existing middleware)
   - Add minimal README section: “TIN utilities + caching policy” explaining why not to call on every submission.

4) Tests
   - packages/storage tests:
     - does not store raw idValue/taxpayerName
     - cache HIT returns expected
   - packages/myinvois-client tests:
     - correct upstream URL formatting:
       /taxpayer/validate/{tin}?idType=...&idValue=...
     - handles 404 as invalid
     - extracts Retry-After on 429
   - gateway route tests (fastify.inject):
     - MISS => upstream called => cache stored => response ok
     - HIT => upstream NOT called => response ok and X-Cache=HIT
     - forceRefresh => bypass cache
     - limiter exceeded => 429 with Retry-After and upstream NOT called
     - upstream 429 => forwarded Retry-After

DEFINITION OF DONE (DoD)
- pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build all pass
- openapi:lint passes (Spectral)
- validate route works with caching + privacy rules
- 429 Retry-After forwarded correctly
- No logs contain raw idValue/taxpayerName

OUTPUT REQUIRED
1) Before coding: concise bullet plan of touched modules/files
2) Implement changes
3) End report:
   - touched files
   - caching keys + TTL policy
   - rate limiting policy + Retry-After propagation
   - local commands: docker compose up, prisma migrate, run gateway, run tests

Start now.
```

[1]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/01-validate-taxpayer-tin/ "Validate Taxpayer's TIN"
[2]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/10-search-taxpayer-tin/ "Search Taxpayer's TIN"
[3]: https://sdk.myinvois.hasil.gov.my/standard-error-response/ "Standard Error Response"
