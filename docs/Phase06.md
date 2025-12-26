Phase 06 implements **Document state changes** (Cancel/Reject) via upstream `PUT /api/v1.0/documents/state/{UUID}/state` with `{ status, reason }` (Cancel uses `cancelled`; Reject uses `rejected`) and **Document Details** via `GET /api/v1.0/documents/{uuid}/details`. ([MyInvois SDK][1])
It must also enforce MyInvois **recommended RPM** (Cancel 12, Reject 12, Get Document Details 125) and obey `429` with `Retry-After`. ([MyInvois SDK][2])

```text
PHASE 06 — EXECUTION PROMPT (Claude Code Opus 4.5)
Project: MyInvois Middleware Gateway (OpenAPI-first, Node/TS, OSS)

MISSION
Implement Document actions + details:
- Cancel Document (issuer) via MyInvois state change API
- Reject Document (receiver/buyer) via the same state change API
- Get Document Details via MyInvois details API
- Enforce endpoint-level RPM guidance and Retry-After handling
- Persist action results and last-known document state in DB
- Full test coverage (mocked upstream)

SOURCE OF TRUTH (implement; do NOT paste large excerpts)
Upstream APIs:
1) Cancel/Reject uses state endpoint:
   PUT /api/v1.0/documents/state/{UUID}/state
   Body: { status, reason }
   - cancel: status must be "cancelled"
   - reject: status must be "rejected"
   Recommended rate limit: 12 RPM / Client ID for each action.
2) Document details:
   GET /api/v1.0/documents/{uuid}/details
   Recommended rate limit: 125 RPM / Client ID.
3) Rate limiting behavior:
   - 429 Too Many Requests returns Retry-After header indicating seconds to wait.

SCOPE (WHAT YOU MUST SHIP)
A) packages/myinvois-client:
   - changeDocumentState(): wraps PUT /documents/state/{uuid}/state
   - getDocumentDetails(): wraps GET /documents/{uuid}/details
   - consistent upstream error normalization:
     - 429 -> typed error with retryAfterSeconds
     - 404 -> typed notFound error
     - others -> typed upstream error with code/message + correlationId
   - integrate with TokenManager (Phase 03) and your rate limiter core

B) apps/gateway:
   - Implement endpoints per OpenAPI:
     - POST /v1/documents/{uuid}/cancel
     - POST /v1/documents/{uuid}/reject
     - GET  /v1/documents/{uuid}/details
   - Ensure:
     - correlationId header present on all responses (already in Phase 02)
     - ErrorEnvelope remains consistent
     - Retry-After header is forwarded on 429 responses
   - Route behavior:
     Cancel:
       - requires { sessionId, reason }
       - calls myinvoisClient.changeDocumentState(status="cancelled")
     Reject:
       - requires { sessionId, reason }
       - calls myinvoisClient.changeDocumentState(status="rejected")
     Details:
       - requires sessionId (query or header per spec)
       - calls myinvoisClient.getDocumentDetails()

C) packages/storage (Prisma):
   - Extend schema to store document action outcomes and last-known doc status.
   - Update repos to persist:
     - lastActionType: CANCEL|REJECT (nullable)
     - lastActionReason (nullable)
     - lastActionAt (nullable)
     - lastUpstreamStatus (nullable)
     - lastUpstreamCorrelationId (nullable)
     - lastErrorCode/lastErrorMessage (nullable)
   - Link by uuid and/or trackingId if you already store SubmissionDocument rows.

D) Tests (must be deterministic, no real MyInvois calls):
   - Unit tests (myinvois-client):
     - cancel sends PUT with correct path/body and Authorization header
     - reject sends PUT with correct status
     - 429 response extracts Retry-After and surfaces typed error
   - Route tests (gateway with fastify.inject):
     - cancel success 200 returns expected response shape + correlationId
     - reject success 200 returns expected response shape + correlationId
     - details success 200 returns normalized subset + correlationId
     - details 404 maps to ErrorEnvelope (and preserves Retry-After if 429)
   - Persistence tests:
     - action results are recorded in DB with status/correlationId

NON-GOALS
- Submission polling logic changes (Phase 05 already)
- Searching documents or retrieving raw document payload (separate endpoints)
- Pre-validating 72-hour windows client-side (let upstream enforce; we only surface clear errors)

AGENT RULES
1) Do not change OpenAPI spec unless you find a concrete mismatch; if changed, keep Spectral green.
2) Never log tokens, client secrets, or full document content; log only uuid/trackingId + status + correlationId.
3) Respect RPM guidance:
   - Cancel: 12 RPM / clientId
   - Reject: 12 RPM / clientId
   - Details: 125 RPM / clientId
   If over limit, return 429 with Retry-After (from limiter) without calling upstream.
4) On upstream 429:
   - forward Retry-After header
   - do not auto-retry in the gateway route (caller decides)
5) Keep implementation modular:
   - upstream calls only in packages/myinvois-client
   - DB logic only in packages/storage
   - gateway only wires and maps to contract

DELIVERABLES (FILE LIST)
1) packages/myinvois-client
   - src/einvoice/changeDocumentState.ts
   - src/einvoice/getDocumentDetails.ts
   - src/einvoice/types.ts (add DocumentStateChangeRequest/Response, DocumentDetails DTO subset)
   - src/errors/myinvoisErrors.ts (ensure retryAfterSeconds + correlationId)
   - src/rateLimits.ts (ensure Cancel/Reject/Details RPM constants)
   - src/index.ts exports

2) packages/storage
   - prisma/schema.prisma (extend SubmissionDocument or add DocumentAction table)
   - src/repositories/documentsRepo.ts:
       recordActionResult(uuid, {actionType, reason, upstreamStatus, correlationId})
       recordDetailsSnapshot(uuid, detailsSubset)
       markActionError(uuid, {errorCode, errorMessage, retryAfterSeconds?})

3) apps/gateway
   - src/routes/v1/documents.ts (new consolidated route file)
   - wire routes into app.ts
   - tests:
     - src/routes/v1/documents.test.ts

IMPLEMENTATION PLAN (DO THIS IN ORDER)
1) myinvois-client:
   a) Implement changeDocumentState(session, { uuid, status, reason })
      - method: PUT
      - path: /api/v1.0/documents/state/{uuid}/state
      - body: { status, reason }
      - enforce rate limiter key: `${clientId}:cancel` or `${clientId}:reject` at 12 RPM
   b) Implement getDocumentDetails(session, { uuid })
      - method: GET
      - path: /api/v1.0/documents/{uuid}/details
      - enforce rate limiter key: `${clientId}:details` at 125 RPM
   c) Normalize errors:
      - if response 429 -> throw UpstreamRateLimitError(retryAfterSeconds)
      - attach upstream correlationId header when present

2) storage:
   - Add/extend model to store:
     - uuid (unique)
     - lastActionType, lastActionReason, lastActionAt
     - lastUpstreamStatus
     - lastUpstreamCorrelationId
     - details snapshot fields (issuerTin, receiverId, totalPayableAmount, dateTimeValidated, status) as nullable
   - Implement documentsRepo methods above.

3) gateway:
   - POST /v1/documents/:uuid/cancel
     - validate: sessionId + reason required; reason length cap (e.g., 1..300)
     - call client.changeDocumentState(status="cancelled")
     - persist success or error to documentsRepo
     - return 200 with response matching OpenAPI
   - POST /v1/documents/:uuid/reject
     - same but status="rejected"
   - GET /v1/documents/:uuid/details
     - validate sessionId
     - call getDocumentDetails
     - persist snapshot
     - return 200 with spec response mapping

4) tests:
   - Use MSW/Nock or fetch mock to simulate upstream:
     - 200 success for cancel/reject/details
     - 429 with Retry-After for each endpoint
     - 404 for details when doc not available
   - Ensure Retry-After forwarding for 429 responses (gateway -> client)

DEFINITION OF DONE (DoD)
- pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build all pass
- OpenAPI lint still passes (Spectral)
- Cancel/Reject/Details routes functional with mocked upstream
- RPM limiter enforced and produces 429 + Retry-After without upstream call
- Upstream 429 surfaces Retry-After and is forwarded
- DB records action results and details snapshots
- No sensitive logs

OUTPUT REQUIRED
1) Before coding: concise bullet plan of files/modules to touch
2) Implement changes
3) End report:
   - touched files
   - how RPM & Retry-After handled
   - local commands to run: db up, migrate, gateway dev, worker optional, tests

Start now.
```

[1]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/03-cancel-document/ "Cancel Document"
[2]: https://sdk.myinvois.hasil.gov.my/integration-practices/ "Integration Practices"
