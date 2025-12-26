Phase 05 is the **background polling + status materialization** phase: use **Get Submission** (not Get Document Details) to monitor processing; poll at **3–5s** and cap at **300 RPM / clientId**, using the API signature with `pageNo/pageSize` (max page size 100). ([MyInvois SDK][1])
When MyInvois throttles, it uses **429 with `Retry-After` seconds**—your worker must obey it and reschedule, not spin. ([MyInvois SDK][2])
For the queue/worker, BullMQ supports **worker-level rate limiting** and **retry with backoff**—use both. ([docs.bullmq.io][3])

```text
PHASE 05 — EXECUTION PROMPT (Claude Code Opus 4.5)
Project: MyInvois Middleware Gateway (OpenAPI-first, Node/TS, OSS)

MISSION
Implement asynchronous status tracking for submissions using MyInvois “Get Submission” API:
- worker app polls MyInvois for each submissionUid
- updates DB (overallStatus + per-document summary fields)
- gateway exposes consistent “read status” endpoints backed by DB
- strict polling interval rules (3–5 seconds) + per-client RPM compliance
- correct 429 Retry-After handling (reschedule, no tight loops)
- end-to-end tests with mocked upstream

SOURCE OF TRUTH (implement; do not paste long excerpts)
- Get Submission signature:
  GET /api/v1.0/documentsubmissions/{submissionUid}?pageNo={pageNo}&pageSize={pageSize}
  max pageSize 100
  overallStatus values: in progress | valid | partially valid | invalid
- Polling guidance:
  3–5 seconds between requests; max 300 RPM / Client ID
- Standard error response:
  429 TooManyRequests includes Retry-After seconds header
- Integration practices RPM table:
  Get Submission 300, Submit 100, Login 12

SCOPE (WHAT YOU MUST SHIP)
A) MyInvois client: getSubmission() implemented and normalized
B) Worker: BullMQ-based polling pipeline with:
   - per-submission min interval 3s (prefer jitter 3–5s)
   - per-clientId rate limiting <= 300 RPM
   - obey Retry-After on 429 and 422 scenarios (if any appear)
   - exponential backoff on transient errors
   - stop condition when overallStatus != "in progress"
C) Persistence:
   - store latest overallStatus + timestamps + per-document summary (uuid/longId/status/dateTimeValidated/etc)
   - store lastPolledAt, nextPollAt, pollAttempts, finalizedAt
D) Gateway:
   - GET /v1/submissions/{trackingId} returns current DB state (including overallStatus and per-document statuses)
   - POST /v1/submissions/{trackingId}/poll enqueues an immediate poll (but must enforce min interval and return Retry-After if too soon)
   - ensure correlationId header continues on all responses
E) Tests:
   - unit tests: scheduler math, rate-limit behavior, Retry-After reschedule
   - worker tests: mocked upstream transitions in progress -> valid
   - route tests: GET status reflects DB updates; POST poll throttling works

NON-GOALS
- Webhooks/events to user systems (unless already in OpenAPI and trivial)
- Document raw retrieval and document details retrieval
- Full observability stack (Prometheus/Grafana) beyond basic logs

AGENT RULES
1) Do not change OpenAPI spec unless invalid; if you must, update spectral + SDK generation in same change.
2) Never log tokens, client secrets, or document body/base64. Log only trackingId, submissionUid, status, counts, and correlationId.
3) Always respect MyInvois polling guidance: 3–5s per submission; do not poll faster than 3s for same submissionUid.
4) Always respect RPM per clientId: Get Submission <= 300 RPM / clientId.
5) On 429, obey Retry-After header and reschedule; do not retry immediately.
6) Use jobId for idempotent job scheduling (avoid duplicate poll storms).

DELIVERABLES (FILES/CHANGES)
1) packages/myinvois-client
   - src/einvoice/getSubmission.ts
   - src/einvoice/types.ts (GetSubmissionResponse DTO)
   - src/index.ts export getSubmission
   - getSubmission(session, { submissionUid, pageNo=1, pageSize=100 }) -> normalized result:
       { submissionUid, overallStatus, documentCount, dateTimeReceived, documentSummary[], correlationId, rateLimit?: {...} }

2) packages/storage (Prisma)
   - Extend models from Phase 04:
     Submission:
       - upstreamOverallStatus (string) already exists; keep
       - lastPolledAt (datetime nullable)
       - nextPollAt (datetime nullable)
       - pollAttempts (int default 0)
       - finalizedAt (datetime nullable)
       - lastUpstreamCorrelationId (string nullable)
       - lastErrorCode/lastErrorMessage (nullable)
     SubmissionDocument:
       - upstreamStatus (string nullable)
       - longId (string nullable)
       - dateTimeValidated (datetime nullable)
       - issuerTin/issuerName/receiverId/receiverName optional (nullable)
       - totalPayableAmount optional (decimal nullable)
   - Repository methods:
       scheduleNextPoll(trackingId, nextPollAt)
       markPolled(trackingId, {overallStatus, correlationId, lastPolledAt, nextPollAt, pollAttempts})
       upsertDocumentSummaries(trackingId, documentSummary[])
       markFinalized(trackingId, finalizedAt)
       markPollError(trackingId, {errorCode, errorMessage, retryAfterSeconds?, nextPollAt})

3) apps/worker
   - New BullMQ worker app:
     /apps/worker/src/index.ts
     /apps/worker/src/queues/pollSubmission.queue.ts
     /apps/worker/src/workers/pollSubmission.worker.ts
     /apps/worker/src/lib/redis.ts
     /apps/worker/src/lib/logger.ts
   - Queue name: "poll-submission"
   - Worker options:
     - concurrency low default (e.g., 10)
     - rate limiting:
        Option 1 (preferred if supported): BullMQ limiter with groupKey=sessionId or clientId
        Option 2: per-clientId limiter using Redis INCR + EXPIRE (60s window)
     - retries:
        attempts: 8
        backoff: exponential, initial 2000ms
   - Job payload:
       { trackingId }
   - Worker flow:
       a) load Submission by trackingId; must have upstreamSubmissionUid and sessionId
       b) enforce per-submission min interval:
          - if now < nextPollAt, reschedule (delay = nextPollAt - now) and exit cleanly
       c) enforce per-clientId RPM:
          - if over limit, compute retryAfterSeconds and reschedule; update DB
       d) call myinvoisClient.getSubmission(session, {submissionUid, pageNo=1, pageSize=100})
       e) update Submission + upsert document summaries
       f) if overallStatus == "in progress":
           - schedule next poll at now + jitter(3000..5000ms)
         else:
           - mark finalized
       g) handle errors:
           - 429: read Retry-After seconds; schedule nextPollAt accordingly
           - 401: refresh token (TokenManager) once then retry job (allow BullMQ attempt)
           - 5xx/network: exponential backoff (BullMQ)
           - unexpected: record error and stop after attempts

4) apps/gateway
   - Update Phase 04 submit endpoint:
     - after SUBMITTED is stored with upstreamSubmissionUid, enqueue first poll job (delay 3000ms)
   - Implement/upgrade:
     - GET /v1/submissions/{trackingId}
       returns:
         trackingId, submissionUid, status fields, overallStatus, timestamps, documents[]
     - POST /v1/submissions/{trackingId}/poll
       behavior:
         - if submission missing or no submissionUid -> 409 with ErrorEnvelope
         - if nextPollAt in future -> 429 with Retry-After (seconds)
         - else enqueue poll job with jobId=trackingId and delay=0; return 202
   - Ensure correlationId header in all responses remains enabled

5) Infra / DX
   - docker-compose:
     - ensure Redis is running (BullMQ needs it)
     - add worker service (optional) or document how to run locally
   - Add scripts:
     - pnpm --filter @myinvois/worker dev
     - pnpm --filter @myinvois/worker start

TESTING REQUIREMENTS
- Unit:
  - jitter range and min interval enforcement
  - per-client RPM limiter returns Retry-After correctly
  - parsing of Get Submission response and status mapping
- Worker integration (mock fetch):
  - submission transitions:
      in progress (2 polls) -> valid
  - 429 returns Retry-After -> job rescheduled and DB updated
- Gateway routes:
  - POST /v1/submissions triggers initial poll enqueue
  - GET /v1/submissions returns updated overallStatus after worker run (use inject + run worker handler directly in test)
  - POST /poll throttles correctly (returns Retry-After when called too soon)

DEFINITION OF DONE (DoD)
- All scripts pass:
  pnpm -r lint
  pnpm -r typecheck
  pnpm -r test
  pnpm -r build
  pnpm openapi:lint
- Worker respects MyInvois:
  - per-submission 3–5s polling interval (never faster than 3s)
  - per-clientId Get Submission <= 300 RPM
  - obey Retry-After on 429
- DB reflects latest upstream state (overall + per-document)
- Gateway exposes status endpoints backed by DB
- No sensitive logging

OUTPUT REQUIRED FROM YOU
1) Before coding: list a concise change plan (bullet list)
2) Implement changes
3) End report:
   - touched files
   - how polling interval + RPM limits enforced
   - how Retry-After is handled
   - commands to run locally (DB + gateway + worker + tests)

Start now.
```

[1]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/06-get-submission/ "Get Submission"
[2]: https://sdk.myinvois.hasil.gov.my/standard-error-response/?utm_source=chatgpt.com "Standard Error Response"
[3]: https://docs.bullmq.io/guide/rate-limiting?utm_source=chatgpt.com "Rate limiting"
