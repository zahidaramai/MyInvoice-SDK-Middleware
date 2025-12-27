# MyInvois Middleware Gateway

[![CI](https://github.com/zahidaramai/MyInvoice-SDK-Middleware/actions/workflows/ci.yml/badge.svg)](https://github.com/zahidaramai/MyInvoice-SDK-Middleware/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

**Open-source middleware gateway for Malaysia's MyInvois e-invoicing system.** Provides a simplified, production-ready REST API layer between your applications and the official LHDN MyInvois API.

> **Disclaimer**: This is an unofficial community project and is not affiliated with LHDN (Lembaga Hasil Dalam Negeri Malaysia). See [DISCLAIMER.md](DISCLAIMER.md) for full terms.

---

## Table of Contents

- [Why Use This Middleware?](#why-use-this-middleware)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Testing](#testing)
- [SDKs](#sdks)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Why Use This Middleware?

Integrating directly with MyInvois API presents several challenges:

| Challenge | MyInvois Direct | This Middleware |
|-----------|-----------------|-----------------|
| **Token Management** | Manual token refresh, handle expiry | Automatic caching (~60 min), transparent refresh |
| **Rate Limiting** | Manual tracking per endpoint | Built-in rate limiter respects LHDN limits |
| **Document Batching** | Handle 100 doc/5MB/300KB limits yourself | Automatic validation and batching |
| **Status Polling** | Implement polling logic | Background worker with configurable intervals |
| **Error Handling** | Parse various error formats | Normalized error envelope with correlationId |
| **Retry Logic** | Implement Retry-After handling | Automatic retry with exponential backoff |

### Key Benefits

- **Simplified Integration**: Clean REST API with consistent request/response formats
- **Production Ready**: Built-in observability, health checks, and metrics
- **Multi-tenant Support**: Handle multiple taxpayers with session-based isolation
- **Type Safety**: Full TypeScript support with generated SDKs
- **OpenAPI First**: Contract-driven development with auto-generated documentation

---

## Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **OAuth2 Token Caching** | Automatic token management with ~60 minute caching |
| **Rate Limit Safety** | Enforces MyInvois RPM caps (Login: 12, Submit: 100, Poll: 300) |
| **Submission Orchestration** | Validates batch constraints (5MB total, 100 docs, 300KB each) |
| **Background Polling** | BullMQ worker polls submission status at safe intervals |
| **Duplicate Detection** | 10-minute deduplication window prevents resubmission |
| **Error Normalization** | Consistent error envelope with upstream correlationId |

### Supported MyInvois Operations

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Submit Documents | `POST /v1/submissions` | Submit e-invoices (UBL 2.1 JSON/XML) |
| Get Submission Status | `GET /v1/submissions/{id}` | Check submission processing status |
| Poll Submission | `POST /v1/submissions/{id}/poll` | Trigger immediate status check |
| Cancel Document | `POST /v1/documents/{uuid}/cancel` | Cancel a valid document |
| Reject Document | `POST /v1/documents/{uuid}/reject` | Reject an incoming document |
| Get Document Details | `GET /v1/documents/{uuid}/details` | Retrieve full document details |
| Validate TIN | `GET /v1/tin/validate` | Validate taxpayer identification |

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Your App      │────▶│  Gateway (REST)  │────▶│  MyInvois API   │
│  (ERP/POS/etc)  │     │  - Auth caching  │     │  (LHDN Sandbox/ │
└─────────────────┘     │  - Rate limiting │     │   Production)   │
                        │  - Validation    │     └─────────────────┘
                        └────────┬─────────┘
                                 │
                        ┌────────▼─────────┐
                        │  Worker (BullMQ) │
                        │  - Status polling│
                        │  - Retry logic   │
                        └────────┬─────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
      ┌───────▼───────┐  ┌───────▼───────┐  ┌──────▼──────┐
      │  PostgreSQL   │  │    Redis      │  │   Metrics   │
      │  (Sessions,   │  │  (Queue,      │  │ (Prometheus)│
      │   Documents)  │  │   Cache)      │  │             │
      └───────────────┘  └───────────────┘  └─────────────┘
```

### Repository Structure

```
├── apps/
│   ├── gateway/           # REST API gateway (Fastify)
│   └── worker/            # Background job processor (BullMQ)
├── packages/
│   ├── core/              # Rate limiter, error normalization, hashing
│   ├── myinvois-client/   # Typed client for MyInvois endpoints
│   ├── storage/           # Prisma + database adapters
│   └── contracts/         # Shared types & Zod schemas
├── openapi/               # OpenAPI 3.0 specification (source of truth)
├── sdks/                  # Generated SDK clients (TS, Python, C#, Java)
├── test/                  # E2E, integration, and contract tests
├── docker/                # Docker compose for local development
└── docs/                  # Extended documentation
```

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 20.x or 22.x (LTS) | v22 recommended |
| **pnpm** | 9.x+ | Package manager |
| **Docker** | Latest | For PostgreSQL & Redis |
| **MyInvois Credentials** | - | Obtain from [LHDN Portal](https://sdk.myinvois.hasil.gov.my/) |

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/zahidaramai/MyInvoice-SDK-Middleware.git
cd myinvois-middleware
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your MyInvois credentials:

```env
# Required: Your MyInvois API credentials from LHDN portal
MYINVOIS_CLIENT_ID=your-client-id
MYINVOIS_CLIENT_SECRET_1=your-primary-secret
MYINVOIS_CLIENT_SECRET_2=your-backup-secret

# Required for document submission: Your taxpayer information
MYINVOIS_SUPPLIER_TIN=your-tin-number          # e.g., C12345678901 or IG12345678901
MYINVOIS_SUPPLIER_ID_TYPE=BRN                   # BRN, NRIC, PASSPORT, or ARMY
MYINVOIS_SUPPLIER_ID_VALUE=your-id-value        # Your BRN or NRIC number

# Environment: SANDBOX for testing, PROD for production
MYINVOIS_ENV=SANDBOX
```

### 3. Start Infrastructure

```bash
# Start PostgreSQL and Redis
docker compose -f docker/docker-compose.yml up -d

# Verify services are running
docker compose -f docker/docker-compose.yml ps
```

### 4. Run Database Migrations

```bash
pnpm --filter @myinvois/storage prisma migrate dev
```

### 5. Start the Gateway

```bash
# Development mode with hot reload
pnpm --filter @myinvois/gateway dev

# Or production build
pnpm build
node apps/gateway/dist/server.js
```

The gateway will be available at `http://localhost:3000`.

### 6. Verify Installation

```bash
# Health check
curl http://localhost:3000/healthz

# Version info
curl http://localhost:3000/version
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Gateway HTTP port |
| `HOST` | No | `0.0.0.0` | Gateway bind address |
| `NODE_ENV` | No | `development` | Environment mode |
| `LOG_LEVEL` | No | `info` | Logging level (debug, info, warn, error) |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `REDIS_URL` | Yes | - | Redis connection string |
| `MYINVOIS_CLIENT_ID` | Yes | - | Your MyInvois client ID |
| `MYINVOIS_CLIENT_SECRET_1` | Yes | - | Primary client secret |
| `MYINVOIS_CLIENT_SECRET_2` | No | - | Backup client secret (for rotation) |
| `MYINVOIS_ENV` | Yes | `SANDBOX` | Target environment: `SANDBOX` or `PROD` |
| `MYINVOIS_SUPPLIER_TIN` | Yes* | - | Your taxpayer TIN (*required for submissions) |
| `MYINVOIS_SUPPLIER_ID_TYPE` | Yes* | `BRN` | ID type: `NRIC`, `BRN`, `PASSPORT`, `ARMY` |
| `MYINVOIS_SUPPLIER_ID_VALUE` | Yes* | - | Your ID value (NRIC or BRN number) |
| `METRICS_ENABLED` | No | `true` | Enable Prometheus metrics |
| `METRICS_ROUTE` | No | `/metrics` | Metrics endpoint path |

### MyInvois Credentials Setup

1. **Register at LHDN Portal**: Visit [MyInvois SDK Portal](https://sdk.myinvois.hasil.gov.my/)
2. **Create API Credentials**: Generate client ID and secrets
3. **Note Your TIN**: Find your Tax Identification Number in your profile
4. **Sandbox vs Production**:
   - Sandbox: `preprod-api.myinvois.hasil.gov.my`
   - Production: `api.myinvois.hasil.gov.my`

### Individual vs Company Taxpayer

| Taxpayer Type | TIN Format | ID Type | ID Value |
|---------------|------------|---------|----------|
| Individual | `IG` + digits | `NRIC` | IC number (e.g., 901120125931) |
| Company | `C` + digits | `BRN` | Business registration number |

---

## API Reference

### OpenAPI Specification

The complete API is documented in OpenAPI 3.0 format:

- **Spec Location**: [openapi/openapi.yaml](openapi/openapi.yaml)
- **Swagger UI**: Available at `/docs` when running in development

### Core Endpoints

#### Health & Status

```bash
# Liveness probe
GET /healthz

# Readiness probe (checks DB & Redis)
GET /readyz

# Version information
GET /version
```

#### Sessions

Sessions represent authenticated connections to MyInvois.

```bash
# Create a session (taxpayer mode)
POST /v1/sessions
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "env": "SANDBOX",
  "mode": "TAXPAYER"
}

# Create a session (intermediary mode)
POST /v1/sessions
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "env": "SANDBOX",
  "mode": "INTERMEDIARY",
  "onBehalfOf": "C12345678901"
}

# Get session details
GET /v1/sessions/{sessionId}

# Delete session
DELETE /v1/sessions/{sessionId}
```

#### Document Submission

```bash
# Submit documents
POST /v1/submissions
X-Session-Id: sess_xxxxx
{
  "documents": [
    {
      "format": "JSON",
      "document": "base64-encoded-ubl-invoice",
      "documentHash": "sha256-hash-of-document",
      "codeNumber": "INV-2024-001"
    }
  ]
}

# Response (202 Accepted)
{
  "trackingId": "trk_xxxxx",
  "submissionUid": "XXXXX",
  "acceptedDocuments": [
    { "codeNumber": "INV-2024-001", "uuid": "document-uuid" }
  ],
  "rejectedDocuments": []
}
```

#### Submission Status

```bash
# Get submission status
GET /v1/submissions/{trackingId}

# Trigger immediate poll
POST /v1/submissions/{trackingId}/poll
```

#### Document Operations

```bash
# Cancel a document (issuer only, within 72 hours)
POST /v1/documents/{uuid}/cancel
X-Session-Id: sess_xxxxx
{
  "reason": "Issued in error"
}

# Reject a document (receiver only, within 72 hours)
POST /v1/documents/{uuid}/reject
X-Session-Id: sess_xxxxx
{
  "reason": "Incorrect details"
}

# Get document details
GET /v1/documents/{uuid}/details
X-Session-Id: sess_xxxxx
```

#### TIN Validation

```bash
# Validate a TIN
GET /v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567
X-Session-Id: sess_xxxxx
```

### Error Response Format

All errors follow a consistent format:

```json
{
  "error": {
    "httpStatus": 400,
    "errorCode": "VALIDATION_ERROR",
    "messageEN": "Invalid document format",
    "messageMS": "Format dokumen tidak sah",
    "correlationId": "upstream-correlation-id",
    "retryAfterSeconds": 60,
    "upstream": {
      "service": "MYINVOIS",
      "path": "/api/v1.0/documentsubmissions/"
    }
  }
}
```

---

## Testing

### Test Types

| Type | Location | Command |
|------|----------|---------|
| Unit Tests | `packages/*/src/*.test.ts` | `pnpm test` |
| E2E Tests | `test/e2e/*.e2e.test.ts` | `pnpm test` |
| Contract Tests | `test/openapi/contract.test.ts` | `pnpm vitest run test/openapi` |
| Integration Tests | `test/integration/*.test.ts` | See below |
| Load Tests | `load/k6-smoke.js` | `k6 run load/k6-smoke.js` |

### Run All Tests

```bash
# Run all tests (requires Docker for Testcontainers)
pnpm test

# Skip Testcontainers (unit tests only)
SKIP_TESTCONTAINERS=true pnpm test
```

### Real Sandbox Integration Tests

Test against the actual MyInvois sandbox API:

```bash
# Ensure .env has valid credentials
# Run integration tests
SKIP_TESTCONTAINERS=true pnpm vitest run test/integration/real-sandbox.integration.test.ts
```

### Submit a Test Invoice

```bash
# Submit a real e-invoice to sandbox
SKIP_TESTCONTAINERS=true pnpm vitest run test/integration/submit-invoice.integration.test.ts
```

### Load Testing

```bash
# Install k6
brew install k6  # macOS
# or: https://k6.io/docs/getting-started/installation/

# Run smoke test
k6 run load/k6-smoke.js
```

---

## SDKs

Client SDKs are auto-generated from the OpenAPI specification:

| Language | Directory | Generator |
|----------|-----------|-----------|
| TypeScript | `sdks/typescript/` | typescript-axios |
| Python | `sdks/python/` | python |
| C# (.NET 8) | `sdks/dotnet/` | csharp |
| Java | `sdks/java/` | java (native) |

### Generate SDKs

```bash
# Requires Docker
pnpm gen:sdk
```

### Using the TypeScript SDK

```typescript
import { SessionsApi, SubmissionsApi, Configuration } from '@myinvois/sdk';

const config = new Configuration({
  basePath: 'http://localhost:3000',
});

// Create a session
const sessionsApi = new SessionsApi(config);
const session = await sessionsApi.createSession({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  env: 'SANDBOX',
  mode: 'TAXPAYER',
});

// Submit documents
const submissionsApi = new SubmissionsApi(config);
const submission = await submissionsApi.submitDocuments(
  { documents: [...] },
  { headers: { 'X-Session-Id': session.data.sessionId } }
);
```

---

## Deployment

### Docker

```dockerfile
# Build
docker build -t myinvois-gateway .

# Run
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_URL=redis://... \
  -e MYINVOIS_CLIENT_ID=... \
  myinvois-gateway
```

### Docker Compose (Production)

```yaml
version: '3.8'
services:
  gateway:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/myinvois
      - REDIS_URL=redis://redis:6379
      - MYINVOIS_CLIENT_ID=${MYINVOIS_CLIENT_ID}
      - MYINVOIS_CLIENT_SECRET_1=${MYINVOIS_CLIENT_SECRET_1}
      - MYINVOIS_ENV=PROD
    depends_on:
      - db
      - redis

  worker:
    build: .
    command: node apps/worker/dist/index.js
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/myinvois
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=myinvois
      - POSTGRES_PASSWORD=password

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### Health Checks

Configure your orchestrator to use:

- **Liveness**: `GET /healthz` - Returns 200 if process is alive
- **Readiness**: `GET /readyz` - Returns 200 if DB and Redis are connected

---

## Scripts Reference

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm --filter @myinvois/gateway dev` | Start gateway in development mode |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm format` | Format code with Prettier |
| `pnpm check` | Run lint + typecheck + test + build |
| `pnpm gen:sdk` | Generate SDKs from OpenAPI spec |
| `pnpm changeset` | Create a changeset for versioning |

---

## MyInvois Integration Rules

These rules are mandated by LHDN and enforced by this middleware:

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| Login/Token | 12 RPM per clientId |
| Submit Documents | 100 RPM per clientId |
| Get Submission | 300 RPM per clientId |

### Submission Constraints

| Constraint | Limit |
|------------|-------|
| Documents per submission | Max 100 |
| Submission size | Max 5 MB |
| Document size | Max 300 KB each |
| Duplicate window | 10 minutes |

### Polling Best Practices

- Use **Get Submission** API only (not Get Document/Details/Search)
- Poll at **3-5 second** minimum intervals
- Stop polling when status is `valid`, `invalid`, or `cancelled`

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes and add tests
4. Run checks: `pnpm check`
5. Create a changeset: `pnpm changeset`
6. Submit a pull request

### Code Standards

- TypeScript strict mode
- ESLint + Prettier for formatting
- Vitest for testing
- OpenAPI-first for API changes

---

## Security

For security vulnerabilities, please see [SECURITY.md](SECURITY.md).

**Important**: Never commit `.env` files or expose your MyInvois credentials.

---

## Resources

### Official Documentation

- [MyInvois SDK Documentation](https://sdk.myinvois.hasil.gov.my/)
- [MyInvois Integration Practices](https://sdk.myinvois.hasil.gov.my/integration-practices/)
- [Submit Documents API](https://sdk.myinvois.hasil.gov.my/einvoicingapi/02-submit-documents/)
- [Get Submission API](https://sdk.myinvois.hasil.gov.my/einvoicingapi/06-get-submission/)
- [Standard Error Response](https://sdk.myinvois.hasil.gov.my/standard-error-response/)

### Project Documentation

- [API Contract](openapi/openapi.yaml)
- [Contributing Guide](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

---

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- Built with [Fastify](https://www.fastify.io/), [BullMQ](https://docs.bullmq.io/), and [Prisma](https://www.prisma.io/)
- OpenAPI tooling by [Stoplight Spectral](https://stoplight.io/spectral)
- SDK generation by [OpenAPI Generator](https://openapi-generator.tech/)

---

**Developed and maintained by [KLCube Network Agency](https://zahidaramai.com) for the Malaysian developer community.**
