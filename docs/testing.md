# Testing Guide

This document covers the testing strategy for the MyInvois Middleware Gateway, with a focus on negative testing and error handling.

## Test Structure

```
test/
├── e2e/                    # End-to-end tests with MSW mocking
├── integration/            # Real sandbox API tests (requires credentials)
├── msw/                    # Mock Service Worker handlers
│   ├── handlers.ts         # Happy path handlers
│   ├── handlers-negative.ts # Error scenario handlers
│   ├── state.ts            # Stateful mock management
│   └── server.ts           # MSW server setup
└── fixtures/               # Test data fixtures

apps/gateway/test/
└── negative/               # Gateway-specific negative tests
    ├── submissions.negative.test.ts
    └── tin-validation.negative.test.ts

apps/worker/test/
└── negative/               # Worker-specific negative tests
    └── poll-worker.negative.test.ts
```

## Negative Test Matrix

The following scenarios are covered by negative tests:

### 3.1 Business Validation Failures (from MyInvois)

| Scenario | MyInvois Step | Error Code | HTTP Status | Retryable |
|----------|---------------|------------|-------------|-----------|
| Duplicate Submission | Duplicated Submission Validator | `DUPLICATE_SUBMISSION` | 409 | No |
| Invalid Taxpayer / Wrong TIN | Taxpayer Profile Validator | `INVALID_TAXPAYER` | 400 | No |
| Totals Mismatch | Amount/Totals Validator | `INVALID_TOTALS` | 400 | No |
| Invalid Document Relation | Document Relation Validator | `INVALID_DOCUMENT_RELATION` | 400 | No |
| Invalid Document Structure | Document Structure Validator | `INVALID_DOCUMENT_STRUCTURE` | 400 | No |

### 3.2 Infrastructure / Platform Failures

| Scenario | Error Code | HTTP Status | Retryable |
|----------|------------|-------------|-----------|
| Upstream Timeout | `UPSTREAM_TIMEOUT` | 504 | Yes |
| Upstream 500 | `UPSTREAM_ERROR` | 502 | Yes |
| Upstream 429 (Rate Limit) | `UPSTREAM_RATE_LIMITED` | 429 | Yes |
| Network Error | `NETWORK_ERROR` | 503 | Yes |

### 3.3 Auth / Session Failures

| Scenario | Error Code | HTTP Status | Retryable |
|----------|------------|-------------|-----------|
| Invalid Client Credentials | `AUTH_INVALID_CLIENT` | 401 | No |
| Invalid Credentials | `AUTH_INVALID_CREDENTIALS` | 401 | No |
| Expired Token | `AUTH_TOKEN_EXPIRED` | 401 | Yes (refresh) |
| Auth Unavailable | `AUTH_UNAVAILABLE` | 503 | Yes |

### 3.4 Local Validation / Guardrails

| Scenario | Error Code | HTTP Status | Retryable |
|----------|------------|-------------|-----------|
| Payload Too Large (>300KB/doc) | `PAYLOAD_TOO_LARGE` | 413 | No |
| Too Many Documents (>100) | `TOO_MANY_DOCUMENTS` | 400 | No |
| Submission Too Large (>5MB) | `PAYLOAD_TOO_LARGE` | 413 | No |
| Missing Required Field | `VALIDATION_ERROR` | 400 | No |
| Idempotency Conflict | `IDEMPOTENCY_CONFLICT` | 409 | No |

## Running Tests

### Unit Tests (fast, no containers)

```bash
SKIP_TESTCONTAINERS=true pnpm test
```

### Full Test Suite (with PostgreSQL and Redis)

```bash
pnpm test
```

### Specific Negative Tests

```bash
# Gateway negative tests
pnpm vitest run apps/gateway/test/negative

# Worker negative tests
pnpm vitest run apps/worker/test/negative

# Error normalizer tests
pnpm vitest run packages/myinvois-client/src/error-normalizer.test.ts
```

## Using MSW Negative Handlers

The negative test handlers are available for use in custom tests:

```typescript
import {
  useMockHandlers,
  negativeHandlers,
  createRateLimitHandler,
  createCustomErrorHandler,
  createTimeoutHandler,
} from "test/msw/server.js";

// Use predefined handler
useMockHandlers(negativeHandlers.duplicateSubmission);

// Create custom rate limit handler
useMockHandlers(createRateLimitHandler(120)); // 120 second retry

// Create custom error
useMockHandlers(
  createCustomErrorHandler(
    "/api/v1.0/documentsubmissions/",
    "POST",
    400,
    { message: "Custom error", code: "CUSTOM_ERROR" }
  )
);

// Create timeout handler
useMockHandlers(
  createTimeoutHandler("/api/v1.0/documentsubmissions/", "POST", 30000)
);
```

## Available Negative Handlers

```typescript
negativeHandlers = {
  // Business validation
  duplicateSubmission,     // 422 - Duplicate submission
  invalidTaxpayer,         // 400 - Invalid TIN
  invalidTaxpayerMalay,    // 400 - Invalid TIN (Malay message)
  invalidTotals,           // 400 - Totals mismatch
  invalidDocumentRelation, // 400 - Invalid document reference
  invalidDocumentStructure,// 400 - Invalid document format

  // Infrastructure
  upstreamTimeout,         // Delayed response (30s)
  upstream500,             // 500 - Internal server error
  upstream502,             // 502 - Bad gateway
  upstream503,             // 503 - Service unavailable
  upstream429,             // 429 - Rate limited

  // Auth
  invalidClient,           // 401 - Invalid client credentials
  invalidCredentials400,   // 400 - Invalid client (OAuth error)
  expiredToken,            // 401 - Token expired
  tokenUnavailable,        // 503 - Token service down
  tokenTimeout,            // Token endpoint timeout

  // Polling
  submissionNotFound,      // 404 - Submission not found
  submissionInvalid,       // 200 - Submission with invalid document
  submissionDuplicate,     // 200 - Submission with duplicate document

  // TIN
  tinNotFound,             // 404 - TIN not found
  tinRateLimit,            // 429 - TIN validation rate limited
};
```

## Error Envelope Contract

All error responses conform to this structure:

```typescript
interface ErrorEnvelope {
  code: string;              // Internal error code (e.g., "DUPLICATE_SUBMISSION")
  message: string;           // Human-readable message
  httpStatus: number;        // HTTP status code
  retryable: boolean;        // Should client retry?
  upstream?: {
    source: "MYINVOIS" | "MIDDLEWARE";
    status?: number;         // Original HTTP status
    errorCode?: string;      // MyInvois error code
    errorName?: string;      // Validation step name
  };
  field?: string;            // Field that caused error
  propertyPath?: string;     // JSON path to field
  correlationId?: string;    // Request correlation ID
  trackingId?: string;       // Submission tracking ID
  retryAfterSeconds?: number; // For rate limiting
}
```

## Testing Best Practices

1. **No real network calls**: All tests use MSW mocks
2. **Assert on normalized envelope**: Don't assert on raw MyInvois payloads
3. **Deterministic tests**: No random sleeps; use proper hooks/events
4. **No secrets in tests**: Never log base64 bodies or credentials
5. **Follow OpenAPI contract**: Tests should validate against the spec
