## Summary

You’re building an **OpenAPI-first, Node.js/TypeScript middleware gateway** that turns MyInvois’ “ERP-integration complexity” into a clean, stable, OSS-friendly API. The highest-leverage value is: **token caching + rate-limit safety + submission orchestration + polling worker + normalized errors**, aligned to MyInvois’ documented recommended practices (3–5s polling, token reuse, RPM caps, Retry-After handling). ([MyInvois SDK][1])

---

# PRD — MyInvois Open Middleware Gateway (API 1.0)

## 1) Problem

Integrating MyInvois is tedious because teams must implement:

* OAuth client credentials correctly and **avoid re-auth on every call** (token valid ~60 minutes) ([MyInvois SDK][2])
* Submission batching constraints (5MB / 100 docs / 300KB per doc) ([MyInvois SDK][3])
* Submission monitoring via **Get Submission polling** (3–5s, max 300 RPM) ([MyInvois SDK][4])
* Uniform handling of **429 + Retry-After**, correlation IDs, standard error schema ([MyInvois SDK][5])
* Environment differences (PROD vs SANDBOX hostnames) ([MyInvois SDK][6])

This repeats across every ERP/POS/SaaS team.

## 2) Goals (what “done” means)

### G1 — Simple integration surface (OpenAPI-first)

* A stable public OpenAPI contract (`openapi.yaml`) that wraps core MyInvois operations.

### G2 — Operational safety by default

* Token caching, retries, **rate-limit awareness**, and error normalization.
* Built-in submission orchestration + polling worker per MyInvois guidance. ([MyInvois SDK][1])

### G3 — OSS usability

* Docker compose for local dev + sandbox testing.
* Example clients (Node/PHP/Python/.NET) generated from the OpenAPI contract.

## 3) Non-goals (explicitly out of scope for v0)

* Official legal/tax advice.
* Acting as a certification/validation authority.
* Full digital signature generation as a hard dependency (gateway should support **bring-your-own-signed-doc**; signature tooling can be a plugin/optional package). MyInvois documents signature requirements and notes around v1.1 signature validation. ([MyInvois SDK][7])

## 4) Target users

* ERP/POS/SaaS developers integrating MyInvois.
* Intermediaries submitting on behalf of taxpayers using `onbehalfof`. ([MyInvois SDK][8])

## 5) Key use cases

1. **Submit** 1..100 documents (XML/JSON) in a single submission and get tracking IDs. ([MyInvois SDK][3])
2. **Poll** submission status safely (3–5s interval, max 300 RPM). ([MyInvois SDK][4])
3. **Cancel/Reject** document state via the shared state endpoint. ([MyInvois SDK][9])
4. **Validate TIN** with caching to avoid being throttled / treated as malicious. ([MyInvois SDK][10])
5. **Intermediary mode** login on behalf of taxpayer (`onbehalfof`). ([MyInvois SDK][8])

## 6) Functional requirements

### FR1 — Environment config

* Support PROD + SANDBOX base URLs as documented:

  * PROD: `api.myinvois.hasil.gov.my`
  * SANDBOX: `preprod-api.myinvois.hasil.gov.my` ([MyInvois SDK][6])

### FR2 — Auth (Taxpayer + Intermediary)

* OAuth2 client_credentials `POST /connect/token` (identity service base URL). ([MyInvois SDK][2])
* Token reuse for ~60 minutes; refresh on 401. ([MyInvois SDK][2])
* Intermediary login must send `onbehalfof` header format rules. ([MyInvois SDK][8])

### FR3 — Submit documents

* Wrap MyInvois `POST /api/v1.0/documentsubmissions/` ([MyInvois SDK][3])
* Enforce payload constraints: **5MB submission**, **100 docs max**, **300KB per doc**. ([MyInvois SDK][3])
* Auto-calc:

  * `document` base64
  * `documentHash` SHA-256
  * pass-through `codeNumber` ([MyInvois SDK][3])
* Handle `422 DuplicateSubmission` with `Retry-After` guidance. ([MyInvois SDK][3])

### FR4 — Polling + status

* Use MyInvois “Get Submission API” for monitoring (not document endpoints). ([MyInvois SDK][1])
* Enforce 3–5s polling and cap 300 RPM per client id guidance. ([MyInvois SDK][4])

### FR5 — Cancel/Reject state

* Wrap MyInvois `PUT /api/v1.0/documents/state/{UUID}/state` for cancel/reject. ([MyInvois SDK][9])

### FR6 — Standard error normalization

* Return a stable gateway error object that always includes:

  * `correlationId` (from response header)
  * `httpStatus`, `errorCode`, `propertyPath`, `error`, `errorMS`, `innerError[]`
  * `retryAfterSeconds` if present ([MyInvois SDK][5])

## 7) Non-functional requirements

* **Reliability:** safe retry/backoff, strict throttling compliance. ([MyInvois SDK][1])
* **Security:** secrets never logged; TLS only (MyInvois describes TLS expectations). ([MyInvois SDK][11])
* **Observability:** structured logs include correlationId, submissionUid, trackingId. ([MyInvois SDK][5])
* **Performance:** Fastify + undici; worker for polling.

---

# Module contracts (TypeScript-oriented)

## Repo layout (monorepo)

* `apps/gateway` — HTTP server (Fastify)
* `apps/worker` — BullMQ polling worker
* `packages/contracts` — Zod schemas + OpenAPI generator
* `packages/myinvois-client` — typed client for MyInvois endpoints + retries
* `packages/core` — auth cache, rate limiter, error normalization
* `packages/storage` — persistence adapters (Prisma/Postgres, SQLite dev)

## Core types (contracts)

```ts
export type Environment = "PROD" | "SANDBOX";

export type Mode = "TAXPAYER" | "INTERMEDIARY";

export interface MyInvoisHosts {
  portalBase: string;
  systemApiBase: string;      // e.g. https://api.myinvois.hasil.gov.my
  identityApiBase: string;    // same as system in docs
}

export interface SessionCreateInput {
  env: Environment;
  mode: Mode;
  clientId: string;
  clientSecret: string;
  onBehalfOf?: string; // required when mode=INTERMEDIARY (TIN or TIN:ROB)
}

export interface Session {
  id: string; // gateway session id
  env: Environment;
  mode: Mode;
  taxpayerContext: {
    onBehalfOf?: string;
  };
}

export interface SubmitDocInput {
  format: "XML" | "JSON";
  // either provide raw document (gateway will base64+hash) OR provide already-prepared fields
  rawDocument?: string; // XML/JSON string
  documentBase64?: string;
  documentHashSha256?: string;
  codeNumber: string;
}

export interface SubmitRequest {
  sessionId: string;
  documents: SubmitDocInput[];
  // behavior knobs (optional)
  autoMinify?: boolean;
  asyncPolling?: boolean; // default true
}

export interface SubmitResult {
  trackingId: string;     // gateway tracking id
  submissionUid: string;  // myinvois submissionUID
  acceptedDocuments: Array<{ codeNumber: string; uuid: string }>;
  rejectedDocuments: Array<{ codeNumber: string; error: GatewayError }>;
}
```

## Error contract (stable across all endpoints)

```ts
export interface GatewayError {
  correlationId?: string; // from MyInvois response header
  httpStatus: number;
  errorCode?: string;
  propertyName?: string | null;
  propertyPath?: string | null;
  target?: string | null;
  messageEN: string;
  messageMS?: string;
  inner?: GatewayError[];
  retryAfterSeconds?: number;
  upstream?: { service: "MYINVOIS"; path: string };
}
```

**Why this shape:** it directly mirrors MyInvois standard error structure (including `errorMS`, `innerError`) and correlation ID behavior. ([MyInvois SDK][5])

## Persistence contract (minimum viable)

```ts
export interface SubmissionRecord {
  trackingId: string;
  sessionId: string;
  submissionUid: string;
  status: "SUBMITTED" | "PROCESSING" | "VALID" | "INVALID" | "CANCELLED" | "UNKNOWN";
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord {
  trackingId: string;
  codeNumber: string;
  uuid?: string;
  status?: string;
  lastError?: GatewayError;
}
```

---

# Endpoint specs (Gateway API v1)

## Header rules (gateway)

Gateway accepts standard JSON and returns JSON; it also surfaces upstream rate-limit/correlation signals.
MyInvois standard headers include `Authorization: Bearer`, response `correlationId`, and rate limit headers. ([MyInvois SDK][12])

## 1) Sessions

### `POST /v1/sessions`

Creates a gateway session and primes token caching.

**Request**

```json
{
  "env": "SANDBOX",
  "mode": "INTERMEDIARY",
  "clientId": "xxx",
  "clientSecret": "yyy",
  "onBehalfOf": "IG12345678912:201901234567"
}
```

**Rules**

* If `mode=INTERMEDIARY`, `onBehalfOf` is mandatory and must follow MyInvois’ `onbehalfof` requirements. ([MyInvois SDK][8])

**Response 201**

```json
{ "id": "sess_...", "env": "SANDBOX", "mode": "INTERMEDIARY" }
```

---

## 2) Submissions

### `POST /v1/submissions`

Submits documents to MyInvois and returns a tracking ID. Uses MyInvois Submit Documents API under the hood. ([MyInvois SDK][3])

**Request**

```json
{
  "sessionId": "sess_...",
  "documents": [
    { "format": "JSON", "rawDocument": "{...}", "codeNumber": "INV-10001" }
  ],
  "autoMinify": true,
  "asyncPolling": true
}
```

**Hard validations**

* max 100 docs, max 5MB per submission, max 300KB per doc. ([MyInvois SDK][3])

**Response 202**

```json
{
  "trackingId": "trk_...",
  "submissionUid": "HJSD135P2S7D8IU...",
  "acceptedDocuments": [{ "codeNumber": "INV-10001", "uuid": "F9D425P..." }],
  "rejectedDocuments": []
}
```

**Errors**

* 422 duplicate submission includes `retryAfterSeconds` (from Retry-After). ([MyInvois SDK][3])

---

### `GET /v1/submissions/{trackingId}`

Returns normalized status (from DB + fresh poll if needed).

**Response 200**

```json
{
  "trackingId": "trk_...",
  "submissionUid": "HJSD135P2S7D8IU...",
  "status": "PROCESSING",
  "documents": [
    { "codeNumber": "INV-10001", "uuid": "F9D425P...", "status": "Submitted" }
  ]
}
```

**Polling policy**

* If it calls upstream, enforce 3–5s polling and cap (linked to client id). ([MyInvois SDK][4])

---

## 3) Documents state (Cancel / Reject)

### `POST /v1/documents/{uuid}/cancel`

Maps to `PUT /api/v1.0/documents/state/{UUID}/state` with `status=cancelled`. ([MyInvois SDK][9])

### `POST /v1/documents/{uuid}/reject`

Maps to same MyInvois state endpoint with `status=rejected`. ([MyInvois SDK][13])

**Request**

```json
{ "sessionId": "sess_...", "reason": "Wrong buyer details" }
```

---

## 4) Taxpayer utilities

### `GET /v1/tin/validate?tin=...&idType=NRIC&idValue=...`

Wraps `GET /api/v1.0/taxpayer/validate/{tin}` and **caches responses** to reduce calls (MyInvois warns excessive calls may be treated as malicious). ([MyInvois SDK][10])

---

# Roadmap milestones (OSS-oriented)

## v0.1 — “Submission orchestration MVP”

* OpenAPI v1 committed (`openapi.yaml`)
* `/sessions`, `/submissions`, `/submissions/{trackingId}`
* Token cache (60 min), refresh-on-401 ([MyInvois SDK][2])
* Retry/backoff + 429 Retry-After compliance ([MyInvois SDK][5])
* Standardized error mapping (correlationId + innerError) ([MyInvois SDK][5])
* Docker compose: gateway + worker + redis + postgres

## v0.2 — “Document state + TIN utilities”

* Cancel/Reject endpoints ([MyInvois SDK][9])
* TIN validate with cache policy ([MyInvois SDK][10])
* Basic admin endpoint: `/health`, `/metrics`

## v0.3 — “Document retrieval surfaces”

* Optional wrappers for Get Document / Details / Search / Recent (strictly following the anti-pattern warnings: don’t use these for monitoring submissions) ([MyInvois SDK][1])
* Pagination normalization

## v0.4 — “Intermediary-first hardening”

* Stronger `onBehalfOf` validation and permission error clarity ([MyInvois SDK][8])
* Multi-tenant mode (optional): per-tenant credentials vault adapter

## v1.0 — “Stable contract”

* Backwards-compat guarantees on OpenAPI
* SemVer releases + changelog
* Client SDK generation from OpenAPI (optional GitHub Action)

---

# Contribution plan (practical, not ceremonial)

## Repository governance

* **MIT or Apache-2.0** (MIT = faster adoption; Apache-2.0 = stronger patent language)
* `CODE_OF_CONDUCT.md` (Contributor Covenant)
* `SECURITY.md` with disclosure instructions
* `DISCLAIMER.md`: “Unofficial OSS; refer to LHDNM docs; no legal/tax guarantees.”

## Contribution workflow

* Issue templates:

  * bug report (requires correlationId + upstream path)
  * feature request (must map to MyInvois endpoint + cite docs)
* PR rules:

  * must update `openapi.yaml` when API behavior changes
  * must include tests + docs snippet
  * must not log secrets
* Labels:

  * `good-first-issue`, `help-wanted`, `breaking-change`, `docs`, `security`

## Quality gates (GitHub Actions)

* `lint` (eslint)
* `typecheck`
* `unit` + `contract` tests
* `openapi` validation (spectral)
* `docker build` smoke test

---

# Implementation notes that should be “baked in” (not optional)

* **Use Get Submission for monitoring**, not “Get Document/Details/Recent/Search” during submission workflow. ([MyInvois SDK][1])
* Enforce submission size rules (5MB/100/300KB) and recommend minification. ([MyInvois SDK][3])
* Respect documented RPM guidance and standard headers (`X-Rate-Limit-*`, `Retry-After`, `correlationId`). ([MyInvois SDK][12])
* Support PROD/SANDBOX base URLs exactly as documented. ([MyInvois SDK][6])

[1]: https://sdk.myinvois.hasil.gov.my/integration-practices/ "Integration Practices"
[2]: https://sdk.myinvois.hasil.gov.my/api/07-login-as-taxpayer-system/ "Login as Taxpayer System"
[3]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/02-submit-documents/ "Submit Documents"
[4]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/06-get-submission/?utm_source=chatgpt.com "Get Submission"
[5]: https://sdk.myinvois.hasil.gov.my/standard-error-response/ "Standard Error Response"
[6]: https://sdk.myinvois.hasil.gov.my/faq/ "Frequently Asked Questions"
[7]: https://sdk.myinvois.hasil.gov.my/signature/?utm_source=chatgpt.com "Signature"
[8]: https://sdk.myinvois.hasil.gov.my/api/08-login-as-intermediary-system/ "Login as Intermediary System"
[9]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/03-cancel-document/?utm_source=chatgpt.com "Cancel Document"
[10]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/01-validate-taxpayer-tin/?utm_source=chatgpt.com "Validate Taxpayer's TIN"
[11]: https://sdk.myinvois.hasil.gov.my/start/ "Getting started..."
[12]: https://sdk.myinvois.hasil.gov.my/standard-header-parameters/?utm_source=chatgpt.com "Standard Header Parameters"
[13]: https://sdk.myinvois.hasil.gov.my/einvoicingapi/04-reject-document/?utm_source=chatgpt.com "Reject Document"
