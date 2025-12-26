Phase 04 should implement **real “Submit Documents” flow end-to-end** (gateway → MyInvois), including **size constraints** (5 MB per submission, 100 docs max, 300 KB per doc), **DuplicateSubmission handling (10-minute window + `Retry-After`)**, and **persistent storage** for `trackingId ↔ submissionUID` mapping. ([MyInvois SDK][1])
Also align with MyInvois **rate limits** (Submit=100 RPM/client, Get Submission=300 RPM/client) and standard headers/error semantics (`correlationId`, 429 `Retry-After`). ([MyInvois SDK][2])

```text
PHASE 04 — EXECUTION PROMPT (Claude Code Opus 4.5)
Project: MyInvois Middleware Gateway (OpenAPI-first, Node/TS, OSS)

MISSION
Implement the real Submit Documents pipeline (gateway → MyInvois) with:
- strict preflight validation (count + size rules)
- dedupe/idempotency protection (10-minute DuplicateSubmission window)
- resilient error mapping (422 DuplicateSubmission + Retry-After; 429 Retry-After; 400 MaximumSizeExceeded; 403 IncorrectSubmitter)
- persistence (track internal trackingId ↔ MyInvois submissionUID + per-document mapping)
- tests (unit + contract + route tests) + runnable dev workflow

SOURCE OF TRUTH (do NOT paste long excerpts; only implement)
- Submit Documents: POST /api/v1.0/documentsubmissions/ ; returns 202 with submissionUID + acceptedDocuments/rejectedDocuments ; limits: 5MB submission, 100 docs, 300KB per doc ; DuplicateSubmission within 10 minutes + Retry-After header. 
- Standard headers: correlationId + rate-limit headers.
- Standard error response: 429 TooManyRequests includes Retry-After seconds.
- Integration practices: cache token lifetime (default 60 min), avoid resubmitting 20x responses, recommended RPM table.

SCOPE (WHAT YOU MUST SHIP IN THIS PHASE)
A) Gateway: Implement POST /v1/submissions (or the spec’s equivalent) to submit documents
B) Storage: Add Prisma-backed persistence for submissions + documents + idempotency window
C) MyInvois client: Implement submitDocuments() with correct request/response parsing and error normalization
D) Dedupe + retry rules: enforce safe behavior around 422/429 Retry-After
E) Test suite: deterministic tests with mocked upstream
F) Docs: minimal README update for Phase 04 behavior + local dev instructions

NON-GOALS (explicitly out of scope for Phase 04)
- Creating digital signatures, certificate workflows, or signing helpers
- Full async polling worker (that’s next phase unless already spec’d and trivial)
- Search/Get Document APIs beyond what’s needed to support Phase 04

AGENT RULES
1) Do not change the OpenAPI spec unless the implementation proves the spec is internally inconsistent.
2) If you must change spec, update spec + Spectral compliance + regenerated SDKs in the same PR.
3) Never log secrets/tokens/document contents. Only log correlationId + trackingId + submissionUID + counts.
4) Treat signed documents as immutable: DO NOT minify or alter document strings by default.
   - If a “minify” option exists in spec, it must be opt-in and clearly “unsafe if done after signing”.
5) All new logic must have tests.
6) Keep changes modular: client logic in packages/myinvois-client; persistence in packages/storage; routes in apps/gateway.

DELIVERABLES (FILES/CHANGES YOU MUST PRODUCE)
1) packages/myinvois-client
   - src/einvoice/submitDocuments.ts
   - src/einvoice/types.ts (request/response DTOs as needed)
   - src/errors/myinvoisErrors.ts (normalize upstream errors incl Retry-After)
   - ensure request headers: Authorization bearer, Content-Type application/json, Accept application/json; capture correlationId header
   - method signature: submitDocuments(session, { documents: [...] }) -> { submissionUid, acceptedDocuments, rejectedDocuments, correlationId }

2) packages/storage (Prisma)
   - prisma/schema.prisma with models:
     Submission:
       - trackingId (uuid, unique)
       - sessionId (string/uuid)
       - env (SANDBOX|PROD)
       - payloadHash (string)  // sha256 of canonical gateway submission payload
       - upstreamSubmissionUid (string, nullable until upstream returns)
       - status (enum: RECEIVED|SUBMITTED|DUPLICATE_SUPPRESSED|ERROR)
       - upstreamOverallStatus (string nullable) // for future polling: in progress|valid|partially valid|invalid
       - correlationId (string nullable)
       - createdAt, updatedAt
       - retryAfterSeconds (int nullable) // store when DuplicateSubmission or 429 occurs
     SubmissionDocument:
       - id (uuid)
       - submissionTrackingId (fk)
       - codeNumber (string)
       - upstreamUuid (string nullable)
       - initialResult (enum: ACCEPTED|REJECTED)
       - errorCode/errorMessage (nullable)
       - createdAt
     IdempotencyWindow (optional but recommended):
       - sessionId
       - payloadHash
       - submissionTrackingId
       - createdAt
       - expiresAt (10 minutes)
     Add indexes to support:
       - (sessionId, payloadHash) lookup
       - submissionTrackingId join docs
   - src/repositories/submissionsRepo.ts with functions:
       createSubmission()
       findRecentByPayloadHash(sessionId, payloadHash, withinMinutes=10)
       attachUpstreamSubmissionUid()
       storeAcceptedRejectedDocs()
       markDuplicateSuppressed()
       markError()
   - migrations + seed/dev instructions

3) apps/gateway
   - Implement route handler for POST /v1/submissions
     Behavior:
       a) Validate body schema (documents array required; each doc: format in [XML,JSON], document base64 string, documentHash string, codeNumber string)
       b) Preflight constraints:
          - documents.length in [1..100]
          - per-document decoded size <= 300KB (compute from base64 length; do not decode content)
          - overall request payload size <= 5MB (compute Buffer.byteLength(JSON.stringify(upstreamPayload)))
       c) Compute payloadHash (sha256 of canonical JSON string; stable key ordering)
       d) If recent duplicate exists within 10 minutes:
          - return the previously stored submission response (trackingId, submissionUid if present, accepted/rejected mapping if stored)
          - mark as DUPLICATE_SUPPRESSED if this request would have re-submitted
       e) Else:
          - create Submission row with status RECEIVED
          - call myinvoisClient.submitDocuments(...)
          - on success (202): store upstreamSubmissionUid + correlationId + docs mapping; status SUBMITTED
          - return gateway response matching OpenAPI (include trackingId + upstream submissionUid + accepted/rejected)
       f) Error handling:
          - If upstream 422 DuplicateSubmission: surface as per OpenAPI (prefer 409 Conflict OR preserve 422 if spec says so), include Retry-After header if present, store retryAfterSeconds
          - If upstream 429 TooManyRequests: include Retry-After, do not retry automatically here (leave to caller); store retryAfterSeconds
          - Map standard upstream error fields to your GatewayError envelope consistently
   - Ensure response includes correlationId (if your spec supports it) OR store it and include in debug logs

4) Testing
   - Add unit tests:
     - base64 size estimator correctness
     - payloadHash canonicalization stable
     - dedupe window logic (same payload within 10 minutes returns cached result)
   - Add route tests (supertest):
     - 202 accepted path with mocked upstream response
     - 422 DuplicateSubmission with Retry-After forwarded and stored
     - 400 preflight failures: >100 docs, >300KB doc, >5MB submission
   - Mock upstream via nock/msw; do not call real endpoints

5) Minimal Docs
   - README: Phase 04 usage example (POST /v1/submissions), explain:
     - submit constraints (5MB/100/300KB)
     - DuplicateSubmission window + Retry-After behavior
     - recommended RPM (100 submit / 300 get-submission)
     - token caching expectation (do not request new token per call)
   - DEV: how to run DB (docker compose), prisma migrate, start gateway, run tests

DEFINITION OF DONE (DoD)
- All implemented endpoints match OpenAPI responses and status codes
- Preflight validations enforced (count/size) with clear error codes
- Dedupe protection implemented (10-minute window) without upstream re-submit
- Upstream 202/422/429 behaviors handled correctly with Retry-After propagation
- Prisma migrations run clean; tests pass:
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm openapi:lint (Spectral)
- No secrets or document bodies logged

IMPLEMENTATION NOTES (BE STRICT)
- Submit Documents upstream request body must be:
  { "documents": [ { "format": "XML|JSON", "document": "<base64>", "documentHash": "<hash>", "codeNumber": "<ref>" } ... ] }
- Do not alter “document” or “documentHash”; treat as caller-provided.
- Always capture and store correlationId response header when present.
- Never auto-resubmit when you already got any 20x from submission API.

OUTPUT REQUIRED FROM YOU
- Provide a concise change plan (bullet list) then implement the code.
- When done: list all touched files and how to run tests locally.

Start now.
```

[1]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/02-submit-documents/ "Submit Documents"
[2]: https://sdk.myinvois.hasil.gov.my/integration-practices "Integration Practices"
