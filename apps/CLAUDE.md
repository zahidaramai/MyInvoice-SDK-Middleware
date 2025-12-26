# Apps Directory - Claude Code Guidelines

This directory contains the runtime applications for the MyInvois Middleware Gateway.

## Applications Overview

| App | Purpose | Stack |
|-----|---------|-------|
| `gateway/` | HTTP API server | Fastify + TypeScript |
| `worker/` | Background job processor | BullMQ + Redis |

---

## Gateway (`apps/gateway`)

The gateway is the main HTTP entry point that implements the OpenAPI contract.

### Architecture

```
apps/gateway/
├── src/
│   ├── server.ts           # Fastify server setup
│   ├── config.ts           # Environment configuration
│   ├── index.ts            # Entry point
│   ├── routes/             # Route handlers by domain
│   │   ├── health.ts       # /healthz, /readyz, /version
│   │   ├── sessions.ts     # /v1/sessions/*
│   │   ├── submissions.ts  # /v1/submissions/*
│   │   ├── documents.ts    # /v1/documents/*
│   │   └── taxpayer.ts     # /v1/tin/*
│   ├── plugins/            # Fastify plugins
│   │   ├── correlationId.ts
│   │   └── errorHandler.ts
│   └── lib/                # Gateway-specific utilities
│       └── errors.ts
├── package.json
└── tsconfig.json
```

### Route Implementation Rules

#### 1. Always Match OpenAPI Contract

Routes MUST exactly match the `openapi/openapi.yaml` specification:

```typescript
// Check the spec for exact request/response shapes
// apps/gateway/src/routes/submissions.ts

app.post<{
  Body: SubmissionCreateRequest;
  Reply: SubmissionResult | ErrorEnvelope;
}>('/v1/submissions', async (request, reply) => {
  // Request body validated against OpenAPI schema
  // Response must match SubmissionResult or ErrorEnvelope
});
```

#### 2. Correlation ID Handling

Every response MUST include the `X-Correlation-Id` header:

```typescript
// Capture from upstream if available, generate if not
const correlationId = upstreamResponse.headers['correlationid']
  || request.headers['x-correlation-id']
  || generateCorrelationId();

reply.header('X-Correlation-Id', correlationId);
```

#### 3. Error Response Format

All errors use the `ErrorEnvelope` wrapper:

```typescript
// Return consistent error shape
reply.status(400).send({
  error: {
    httpStatus: 400,
    errorCode: 'VALIDATION_ERROR',
    messageEN: 'Invalid document format',
    correlationId,
  }
});
```

#### 4. Rate Limit Headers

When forwarding rate limit info from upstream:

```typescript
if (upstreamResponse.status === 429) {
  const retryAfter = upstreamResponse.headers['retry-after'];
  if (retryAfter) {
    reply.header('Retry-After', retryAfter);
  }
}
```

### Endpoint Implementations

#### Health Endpoints (Non-v1)

```typescript
// GET /healthz - Basic liveness
// Always returns 200 if server is running
{ status: "ok" }

// GET /readyz - Readiness (dependencies checked)
// Returns 200 if DB + Redis connected, 503 otherwise
{ status: "ok" | "degraded", checks: { database: "ok", redis: "ok" } }

// GET /version - Build info
{ name: "myinvois-gateway", version: "0.1.0", commit: "...", buildTime: "..." }
```

#### Sessions (`/v1/sessions`)

```typescript
// POST /v1/sessions - Create session
// - Validate mode matches onBehalfOf requirement
// - Store session metadata (no secrets persisted by default)
// - Optionally test upstream auth if VALIDATE_UPSTREAM=true
// - Return session ID without secrets

// GET /v1/sessions/{sessionId} - Get metadata
// DELETE /v1/sessions/{sessionId} - Invalidate session
```

#### Submissions (`/v1/submissions`)

```typescript
// POST /v1/submissions - Submit documents
// Critical validations:
// 1. documents.length in [1..100]
// 2. each document <= 300KB (estimate from base64 length)
// 3. total payload <= 5MB
// 4. Check dedupe window (10 minutes by payloadHash)
// 5. Call upstream submitDocuments()
// 6. Store tracking mapping
// 7. Return 202 with trackingId + submissionUid

// GET /v1/submissions/{trackingId} - Get status
// POST /v1/submissions/{trackingId}/poll - Trigger immediate poll
```

#### Documents (`/v1/documents`)

```typescript
// POST /v1/documents/{uuid}/cancel
// POST /v1/documents/{uuid}/reject
// GET /v1/documents/{uuid}/details
// Rate limit: 12 RPM for cancel/reject
```

#### Taxpayer (`/v1/tin`)

```typescript
// GET /v1/tin/validate?tin=&idType=&idValue=
// Cache positive results to reduce upstream calls
```

### Plugin Implementation

#### Correlation ID Plugin

```typescript
// plugins/correlationId.ts
// Automatically adds X-Correlation-Id to all responses
// Generates UUID if not provided in request
// Makes correlationId available in request context

app.decorateRequest('correlationId', '');

app.addHook('onRequest', async (request) => {
  request.correlationId = request.headers['x-correlation-id']
    || crypto.randomUUID();
});

app.addHook('onSend', async (request, reply) => {
  reply.header('X-Correlation-Id', request.correlationId);
});
```

#### Error Handler Plugin

```typescript
// plugins/errorHandler.ts
// Catches all errors and normalizes to ErrorEnvelope
// Logs error with correlationId
// Never exposes stack traces in production

app.setErrorHandler(async (error, request, reply) => {
  const gatewayError = normalizeError(error);

  logger.error({
    correlationId: request.correlationId,
    error: gatewayError
  }, 'Request failed');

  reply
    .status(gatewayError.httpStatus)
    .send({ error: gatewayError });
});
```

### Testing Gateway

```typescript
// Use Fastify's inject() for route testing
import { build } from './server';

describe('POST /v1/submissions', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
  });

  it('returns 202 with tracking ID', async () => {
    // Mock upstream with nock/msw
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      payload: { sessionId: 'sess_test', documents: [...] }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toHaveProperty('trackingId');
  });
});
```

---

## Worker (`apps/worker`)

The worker handles background jobs, primarily submission status polling.

### Architecture

```
apps/worker/
├── src/
│   ├── index.ts            # Worker entry point
│   ├── config.ts           # Configuration
│   ├── jobs/               # Job processors
│   │   └── pollSubmission.ts
│   └── queues/             # Queue definitions
│       └── submissionQueue.ts
├── package.json
└── tsconfig.json
```

### Polling Worker Requirements

#### MyInvois Polling Rules (CRITICAL)

```typescript
// MUST use Get Submission API for status polling
// NEVER use Get Document / Details / Search / Recent APIs

const POLL_INTERVAL_MS = 3000;  // Minimum 3 seconds
const MAX_POLL_INTERVAL_MS = 5000;  // Maximum 5 seconds
const MAX_RPM = 300;  // Per clientId
```

#### Job Processing

```typescript
// jobs/pollSubmission.ts

interface PollSubmissionJob {
  trackingId: string;
  submissionUid: string;
  sessionId: string;
  attempt: number;
}

const pollSubmission = async (job: Job<PollSubmissionJob>) => {
  const { trackingId, submissionUid, sessionId } = job.data;

  // 1. Rate limit check (300 RPM per clientId)
  if (isRateLimited(sessionId)) {
    throw new Error('Rate limit would be exceeded');
  }

  // 2. Call Get Submission API
  const status = await myinvoisClient.getSubmission(submissionUid);

  // 3. Update database
  await storage.updateSubmissionStatus(trackingId, status);

  // 4. Check terminal state
  if (['VALID', 'INVALID', 'CANCELLED'].includes(status.overallStatus)) {
    return; // Job complete, don't reschedule
  }

  // 5. Schedule next poll (3-5s delay)
  await submissionQueue.add('poll', {
    ...job.data,
    attempt: job.data.attempt + 1
  }, {
    delay: POLL_INTERVAL_MS
  });
};
```

#### Queue Configuration

```typescript
// queues/submissionQueue.ts
import { Queue, Worker } from 'bullmq';

const submissionQueue = new Queue('submissions', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  }
});

const worker = new Worker('submissions', pollSubmission, {
  connection: redisConnection,
  limiter: {
    max: 300,
    duration: 60000  // 300 per minute
  }
});
```

### Worker Error Handling

```typescript
worker.on('failed', (job, error) => {
  logger.error({
    jobId: job?.id,
    trackingId: job?.data.trackingId,
    error: error.message
  }, 'Polling job failed');
});

worker.on('error', (error) => {
  logger.error({ error }, 'Worker error');
});
```

### Testing Worker

```typescript
describe('pollSubmission', () => {
  it('updates status to VALID when complete', async () => {
    // Mock upstream Get Submission response
    nock(MYINVOIS_API_URL)
      .get('/api/v1.0/documentsubmissions/sub_123')
      .reply(200, { overallStatus: 'Valid' });

    await pollSubmission({
      data: { trackingId: 'trk_1', submissionUid: 'sub_123', sessionId: 'sess_1', attempt: 1 }
    });

    const submission = await storage.getSubmission('trk_1');
    expect(submission.status).toBe('VALID');
  });

  it('reschedules when status is processing', async () => {
    nock(MYINVOIS_API_URL)
      .get('/api/v1.0/documentsubmissions/sub_123')
      .reply(200, { overallStatus: 'In Progress' });

    // Assert job is added back to queue with delay
  });
});
```

---

## Shared Configuration Patterns

### Environment Config

```typescript
// Both apps use similar config pattern
interface Config {
  port: number;
  logLevel: string;
  nodeEnv: 'development' | 'production' | 'test';
  redis: {
    url: string;
  };
  database: {
    url: string;
  };
  myinvois: {
    env: 'SANDBOX' | 'PROD';
    validateUpstream: boolean;
  };
}

const config: Config = {
  port: parseInt(process.env.PORT || '3000'),
  logLevel: process.env.LOG_LEVEL || 'info',
  // ...
};
```

### Logging

```typescript
// Use structured JSON logging
import pino from 'pino';

const logger = pino({
  level: config.logLevel,
  redact: ['clientSecret', 'access_token', 'document', 'documentBase64']
});

// Always include context
logger.info({ correlationId, trackingId }, 'Processing submission');
```

---

## Docker Compose Integration

```yaml
# docker/docker-compose.yml
services:
  gateway:
    build:
      context: ..
      dockerfile: apps/gateway/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis

  worker:
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
```

---

## Common Pitfalls

### Gateway

| Pitfall | Solution |
|---------|----------|
| Missing correlationId in response | Use correlationId plugin consistently |
| Wrong error shape | Always use ErrorEnvelope wrapper |
| Secrets in logs | Configure pino redact paths |
| Exceeding rate limits | Use per-endpoint rate limiters |

### Worker

| Pitfall | Solution |
|---------|----------|
| Using wrong API for polling | ONLY use Get Submission API |
| Polling too fast | Enforce minimum 3s delay |
| Not checking terminal state | Stop polling on VALID/INVALID/CANCELLED |
| Memory leaks | Configure job removal limits |

---

## Development Commands

```bash
# Gateway
cd apps/gateway
pnpm dev          # Start with hot reload
pnpm build        # Build for production
pnpm test         # Run tests
pnpm typecheck    # Type check

# Worker
cd apps/worker
pnpm dev          # Start worker
pnpm build
pnpm test
```

---

## References

- [Root CLAUDE.md](../CLAUDE.md) - Project-wide guidelines
- [OpenAPI Spec](../openapi/openapi.yaml) - API contract
- [MyInvois Get Submission](https://sdk.myinvois.hasil.gov.my/einvoicingapi/06-get-submission/) - Polling API
- [BullMQ Documentation](https://docs.bullmq.io/) - Queue library
