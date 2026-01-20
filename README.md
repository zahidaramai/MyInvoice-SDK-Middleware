# MyInvois Middleware Gateway for v1.0 and v1.1 API

[![CI](https://github.com/zahidaramai/MyInvoice-SDK-Middleware/actions/workflows/ci.yml/badge.svg)](https://github.com/zahidaramai/MyInvoice-SDK-Middleware/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

![MyInvois Middleware Gateway](asset/social-preview.png)

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
  - [Error Response Format (ErrorEnvelope)](#error-response-format-errorenvelope)
  - [Error Codes Reference](#error-codes-reference)
- [Testing](#testing)
  - [Negative Tests (Error Handling)](#negative-tests-error-handling)
- [SDKs](#sdks)
- [Deployment](#deployment)
- [Scripts Reference](#scripts-reference)
- [Issue Document Script](#issue-document-script)
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
| **Document Signing (v1.1)** | X.509 digital signatures for MyInvois v1.1 compliance |

### Document Signing (MyInvois v1.1)

Starting from a date mandated by LHDN, all e-invoices must be digitally signed using X.509 certificates. This middleware provides:

| Feature | Description |
|---------|-------------|
| **Automatic Signing** | Documents are automatically signed when `documentVersion: "1.1"` |
| **Certificate Management** | Load certificates from file, base64, or environment variables |
| **Key Validation** | Verifies private key matches certificate before signing |
| **Expiry Monitoring** | Health checks report certificate expiry status |
| **Performance** | Signing completes in <2ms per document |

#### Document Version Modes

| Version | Signing | Use Case |
|---------|---------|----------|
| `1.0` | Not required | Legacy submissions (unsigned) |
| `1.1` | **Required** | New submissions (signed, LHDN mandate) |

See [Configuration > Signing](#signing-configuration) for setup instructions.

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
│   ├── signing/           # X.509 certificate signing for v1.1 documents
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

### Signing Configuration

For MyInvois v1.1 document signing, you need an X.509 certificate and private key.

#### Signing Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SIGNING_ENABLED` | No | `true` | Enable/disable document signing |
| `SIGNING_DEFAULT_VERSION` | No | `1.0` | Default document version (`1.0` or `1.1`) |
| `SIGNING_CERT_PATH` | Yes* | - | Path to certificate PEM file |
| `SIGNING_KEY_PATH` | Yes* | - | Path to private key PEM file |
| `SIGNING_CERT_BASE64` | Yes* | - | Base64-encoded certificate (alternative to file) |
| `SIGNING_KEY_BASE64` | Yes* | - | Base64-encoded private key (alternative to file) |
| `SIGNING_KEY_PASSPHRASE` | No | - | Passphrase for encrypted private key |
| `SIGNING_PKCS12_PATH` | Yes* | - | Path to PKCS#12 (.p12/.pfx) file |
| `SIGNING_PKCS12_PASSPHRASE` | No | - | Passphrase for PKCS#12 file |

*One of `SIGNING_CERT_PATH`, `SIGNING_CERT_BASE64`, or `SIGNING_PKCS12_PATH` is required for v1.1 submissions.

#### Certificate Setup

1. **Obtain a Certificate**: Get an X.509 certificate from a certificate authority or generate a self-signed certificate for testing.

2. **Prepare Files**:
   ```bash
   # Your certificate and key files
   ls -la certs/
   # cert.pem     - X.509 certificate in PEM format
   # key.pem      - RSA private key in PEM format
   ```

3. **Configure via File Path**:
   ```env
   SIGNING_ENABLED=true
   SIGNING_DEFAULT_VERSION=1.1
   SIGNING_CERT_PATH=/app/certs/cert.pem
   SIGNING_KEY_PATH=/app/certs/key.pem
   ```

4. **Or Configure via Base64** (for containerized deployments):
   ```bash
   # Encode your certificate
   base64 -i certs/cert.pem | tr -d '\n'
   base64 -i certs/key.pem | tr -d '\n'
   ```
   ```env
   SIGNING_CERT_BASE64=LS0tLS1CRUdJTi...
   SIGNING_KEY_BASE64=LS0tLS1CRUdJTi...
   ```

5. **Or Configure via PKCS#12** (.p12/.pfx file):

   PKCS#12 is a common format that bundles the certificate and private key in a single encrypted file. This is often provided by certificate authorities or exported from Windows Certificate Manager.

   ```env
   SIGNING_ENABLED=true
   SIGNING_DEFAULT_VERSION=1.1
   SIGNING_PKCS12_PATH=/app/certs/certificate.p12
   SIGNING_PKCS12_PASSPHRASE=your-p12-password
   ```

   **Converting PKCS#12 to PEM** (if needed):
   ```bash
   # Extract certificate
   openssl pkcs12 -in certificate.p12 -clcerts -nokeys -out cert.pem

   # Extract private key
   openssl pkcs12 -in certificate.p12 -nocerts -nodes -out key.pem
   ```

   **Creating PKCS#12 from PEM files**:
   ```bash
   openssl pkcs12 -export -out certificate.p12 \
     -inkey key.pem -in cert.pem \
     -passout pass:your-p12-password
   ```

#### Certificate Requirements

| Requirement | Value |
|-------------|-------|
| Format | PEM (-----BEGIN CERTIFICATE-----) or PKCS#12 (.p12/.pfx) |
| Key Type | RSA (2048-bit or higher recommended) |
| Signature Algorithm | SHA-256 or higher |
| Validity | Must be valid (not expired, not future-dated) |

#### Verifying Your Certificate

**PEM format:**
```bash
# Check certificate details
openssl x509 -in cert.pem -text -noout

# Verify key matches certificate
openssl x509 -in cert.pem -pubkey -noout | md5
openssl rsa -in key.pem -pubout 2>/dev/null | md5
# Both should output the same hash
```

**PKCS#12 format:**
```bash
# View certificate details from .p12 file
openssl pkcs12 -in certificate.p12 -nokeys -clcerts | openssl x509 -text -noout

# List contents of .p12 file
openssl pkcs12 -in certificate.p12 -info -noout

# Verify .p12 file is valid (prompts for password)
openssl pkcs12 -in certificate.p12 -passin pass:your-password -info
```

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

### Error Response Format (ErrorEnvelope)

All 4xx/5xx errors follow a consistent, unified format called `ErrorEnvelope`:

```json
{
  "error": {
    "code": "DUPLICATE_SUBMISSION",
    "message": "This document has already been submitted. Each invoice can only be submitted once.",
    "httpStatus": 409,
    "retryable": false,
    "upstream": {
      "source": "MYINVOIS",
      "status": 422,
      "errorCode": "ERR003",
      "errorName": "Step03-Duplicated Submission Validator"
    },
    "correlationId": "req_abc123xyz",
    "field": "Customer.TIN"
  }
}
```

#### ErrorEnvelope Fields

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Machine-readable error code (e.g., `DUPLICATE_SUBMISSION`, `INVALID_TAXPAYER`) |
| `message` | string | Human-readable English message, safe to display to users |
| `httpStatus` | number | HTTP status code returned |
| `retryable` | boolean | `true` if client should retry with backoff, `false` if error is permanent |
| `upstream` | object | Context from MyInvois (when applicable) |
| `upstream.source` | string | `"MYINVOIS"` or `"MIDDLEWARE"` |
| `upstream.status` | number | Original HTTP status from MyInvois |
| `upstream.errorCode` | string | MyInvois error code (e.g., `ERR045`) |
| `upstream.errorName` | string | Validation step name (e.g., `Step05-Taxpayer Profile Validator`) |
| `field` | string | Field that caused the error (e.g., `Customer.TIN`) |
| `propertyPath` | string | JSON path to the field (e.g., `documents[0].Customer.TIN`) |
| `correlationId` | string | Unique request ID for debugging |
| `trackingId` | string | Submission tracking ID (when applicable) |
| `retryAfterSeconds` | number | Seconds to wait before retry (for rate limiting) |

#### Error Codes Reference

##### Business Validation Errors (Non-Retryable)

These errors indicate problems with document data that must be fixed before resubmitting:

| Error Code | HTTP Status | Description | MyInvois Validator |
|------------|-------------|-------------|-------------------|
| `DUPLICATE_SUBMISSION` | 409 | Document already submitted | Step03-Duplicated Submission Validator |
| `INVALID_TAXPAYER` | 400 | TIN invalid or not found | Step05-Taxpayer Profile Validator |
| `INVALID_TOTALS` | 400 | Invoice totals mismatch | Amount/Totals Validator |
| `INVALID_DOCUMENT_RELATION` | 400 | Invalid credit/debit note reference | Document Relation Validator |
| `INVALID_DOCUMENT_STRUCTURE` | 400 | Missing/invalid UBL fields | Document Structure Validator |
| `DOCUMENT_VALIDATION_FAILED` | 400 | Generic validation failure | Various |

##### Infrastructure Errors (Retryable)

Temporary errors that should be retried with exponential backoff:

| Error Code | HTTP Status | Description | Retry Strategy |
|------------|-------------|-------------|----------------|
| `UPSTREAM_TIMEOUT` | 504 | MyInvois request timed out | Retry after 5-30 seconds |
| `UPSTREAM_ERROR` | 502 | MyInvois 5xx server error | Retry with exponential backoff |
| `UPSTREAM_RATE_LIMITED` | 429 | Rate limit exceeded | Respect `Retry-After` header |
| `NETWORK_ERROR` | 503 | Network connectivity issue | Retry with backoff |
| `INTERNAL_ERROR` | 500 | Unexpected gateway error | Retry with backoff |

##### Authentication Errors

| Error Code | HTTP Status | Retryable | Description |
|------------|-------------|-----------|-------------|
| `AUTH_INVALID_CLIENT` | 401 | No | Client ID/secret invalid |
| `AUTH_INVALID_CREDENTIALS` | 401 | No | Credentials rejected |
| `AUTH_TOKEN_EXPIRED` | 401 | Yes (auto) | Token expired, auto-refresh |
| `AUTH_UNAVAILABLE` | 503 | Yes | Auth service temporarily down |

##### Local Validation Errors (Non-Retryable)

Caught before sending to MyInvois:

| Error Code | HTTP Status | Description | Limit |
|------------|-------------|-------------|-------|
| `PAYLOAD_TOO_LARGE` | 413 | Document or submission too large | 300KB/doc, 5MB total |
| `TOO_MANY_DOCUMENTS` | 400 | Too many documents in batch | Max 100 |
| `VALIDATION_ERROR` | 400 | Missing/invalid field | Check `propertyPath` |
| `IDEMPOTENCY_CONFLICT` | 409 | Duplicate within 10-min window | Wait for window expiry |

#### Retry Strategy Example

```typescript
async function submitWithRetry(fn: () => Promise<Response>, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fn();
    if (response.ok) return response;

    const { error } = await response.json();
    if (!error.retryable) throw new Error(error.message);

    const delay = error.retryAfterSeconds
      ? error.retryAfterSeconds * 1000
      : Math.pow(2, attempt) * 1000;
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('Max retries exceeded');
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
| **Negative Tests** | `apps/*/test/negative/*.test.ts` | `pnpm vitest run apps/gateway/test/negative` |
| Load Tests | `load/k6-smoke.js` | `k6 run load/k6-smoke.js` |

### Run All Tests

```bash
# Run all tests (requires Docker for Testcontainers)
pnpm test

# Skip Testcontainers (unit tests only)
SKIP_TESTCONTAINERS=true pnpm test
```

### Negative Tests (Error Handling)

The middleware includes comprehensive negative tests that verify correct behavior under failure conditions. These tests use MSW (Mock Service Worker) to simulate MyInvois API errors without real network calls.

#### MyInvois Validation Pipeline

When MyInvois validates a document submission, it runs through sequential validation steps. Each step can pass (`Valid`) or fail (`Invalid`). The middleware normalizes these into stable error codes:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MyInvois Validation Steps                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Step03  │  Duplicated Submission Validator  │  DUPLICATE_SUBMISSION   │
│  Step04  │  Code Field Validator             │  INVALID_DOCUMENT_STRUCTURE │
│  Step05  │  Taxpayer Profile Validator       │  INVALID_TAXPAYER       │
│  Step06  │  Document References Validator    │  INVALID_DOCUMENT_RELATION │
│  Step07  │  Amount/Totals Validator          │  INVALID_TOTALS         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Example: Invalid Taxpayer Error (from MyInvois)

```json
{
  "validationResults": {
    "status": "Invalid",
    "validationSteps": [
      { "status": "Valid", "name": "Step03-Duplicated Submission Validator" },
      { "status": "Valid", "name": "Step04-Code Field Validator" },
      {
        "status": "Invalid",
        "name": "Step05-Taxpayer Profile Validator",
        "error": {
          "propertyName": "CustomerTin",
          "propertyPath": "document.Invoice.AccountingCustomerParty.Party.PartyIdentification.ID",
          "errorCode": "ERR406",
          "error": "Step05-Invalid Taxpayer Profile Validator",
          "errorMs": "Step05-Pengesah Profil Pembayar Cukai Tidak Sah",
          "innerError": [{
            "propertyName": "CustomerTin",
            "errorCode": "ERR406",
            "error": "Buyer TIN is invalid. Kindly use the Search TIN function to get the correct TIN",
            "errorMs": "TIN pembeli tidak sah. Sila gunakan fungsi Carian TIN untuk mendapatkan TIN yang betul"
          }]
        }
      }
    ]
  }
}
```

**Normalized to ErrorEnvelope:**

```json
{
  "error": {
    "code": "INVALID_TAXPAYER",
    "message": "Buyer TIN is invalid. Kindly use the Search TIN function to get the correct TIN",
    "httpStatus": 400,
    "retryable": false,
    "upstream": {
      "source": "MYINVOIS",
      "status": 200,
      "errorCode": "ERR406",
      "errorName": "Step05-Taxpayer Profile Validator"
    },
    "field": "CustomerTin",
    "propertyPath": "document.Invoice.AccountingCustomerParty.Party.PartyIdentification.ID"
  }
}
```

#### Negative Test Matrix

##### MyInvois Business Validation Failures

| Scenario | MyInvois Step | Error Code | Middleware Code | HTTP | Retryable |
|----------|---------------|------------|-----------------|------|-----------|
| Duplicate Submission | Step03-Duplicated Submission Validator | ERR003 | `DUPLICATE_SUBMISSION` | 409 | No |
| Invalid TIN | Step05-Taxpayer Profile Validator | ERR406 | `INVALID_TAXPAYER` | 400 | No |
| Totals Mismatch | Step07-Amount/Totals Validator | ERR045 | `INVALID_TOTALS` | 400 | No |
| Invalid Reference | Step06-Document References Validator | ERR050 | `INVALID_DOCUMENT_RELATION` | 400 | No |
| Bad Structure | Step04-Code Field Validator | ERR044 | `INVALID_DOCUMENT_STRUCTURE` | 400 | No |

##### Infrastructure/Platform Failures

| Scenario | Upstream Response | Middleware Code | HTTP | Retryable |
|----------|-------------------|-----------------|------|-----------|
| Timeout | No response (>30s) | `UPSTREAM_TIMEOUT` | 504 | Yes |
| Server Error | 500 Internal Error | `UPSTREAM_ERROR` | 502 | Yes |
| Rate Limited | 429 Too Many Requests | `UPSTREAM_RATE_LIMITED` | 429 | Yes |
| Network Error | Connection refused | `NETWORK_ERROR` | 503 | Yes |

##### Authentication Failures

| Scenario | Upstream Response | Middleware Code | HTTP | Retryable |
|----------|-------------------|-----------------|------|-----------|
| Invalid Client | 401 invalid_client | `AUTH_INVALID_CLIENT` | 401 | No |
| Bad Credentials | 400 invalid_client | `AUTH_INVALID_CREDENTIALS` | 401 | No |
| Expired Token | 401 token expired | `AUTH_TOKEN_EXPIRED` | 401 | Yes (auto) |
| Auth Unavailable | 503 Service Down | `AUTH_UNAVAILABLE` | 503 | Yes |

##### Signature Validation Failures (v1.1 Documents)

These errors occur when MyInvois rejects a digitally signed v1.1 document:

| Scenario | Upstream Code | Middleware Code | HTTP | Retryable |
|----------|---------------|-----------------|------|-----------|
| Missing Signature | SignatureRequired | `SIGNING_REQUIRED` | 400 | No |
| Digest Mismatch | DigestMismatch | `DIGEST_MISMATCH` | 400 | No |
| Invalid Signature | SignatureInvalid | `SIGNATURE_INVALID` | 400 | No |
| Certificate Rejected | CertificateRejected | `CERTIFICATE_REJECTED` | 400 | No |
| Certificate Expired | CertificateExpired | `CERTIFICATE_EXPIRED` | 400 | No |
| TIN Mismatch | TinMismatch | Error message contains "TIN" | 400 | No |

##### Local Signing Failures (Pre-submission)

These errors are caught by the gateway before sending to MyInvois:

| Scenario | Trigger | Middleware Code | HTTP | Retryable |
|----------|---------|-----------------|------|-----------|
| Signing Disabled | v1.1 requested, signing off | `SIGNING_DISABLED` | 503 | No |
| Not Configured | v1.1 requested, no certificate | `SIGNING_NOT_CONFIGURED` | 503 | No |
| Cert Load Failed | Cannot read certificate file | `CERTIFICATE_LOAD_FAILED` | 500 | No |
| Key Load Failed | Cannot read private key file | `PRIVATE_KEY_LOAD_FAILED` | 500 | No |
| Key Mismatch | Key doesn't match certificate | `KEY_CERTIFICATE_MISMATCH` | 500 | No |
| Cert Expired | Certificate past validity | `CERTIFICATE_EXPIRED` | 503 | No |
| Cert Not Valid Yet | Certificate future validity | `CERTIFICATE_NOT_YET_VALID` | 503 | No |
| Signing Failed | Crypto operation failed | `SIGNING_FAILED` | 500 | No |

##### Local Validation Failures (Pre-submission)

| Scenario | Trigger | Middleware Code | HTTP | Retryable |
|----------|---------|-----------------|------|-----------|
| Doc Too Large | Document >300KB | `PAYLOAD_TOO_LARGE` | 413 | No |
| Batch Too Large | Submission >5MB | `PAYLOAD_TOO_LARGE` | 413 | No |
| Too Many Docs | >100 documents | `TOO_MANY_DOCUMENTS` | 400 | No |
| Missing Field | Required field null | `VALIDATION_ERROR` | 400 | No |
| Idempotency | Same request <10min | `IDEMPOTENCY_CONFLICT` | 409 | No |

#### Running Negative Tests

```bash
# All negative tests
SKIP_TESTCONTAINERS=true pnpm vitest run apps/gateway/test/negative apps/worker/test/negative

# Gateway submission tests
SKIP_TESTCONTAINERS=true pnpm vitest run apps/gateway/test/negative/submissions.negative.test.ts

# Gateway signing tests (v1.1)
SKIP_TESTCONTAINERS=true pnpm vitest run apps/gateway/test/negative/signing.negative.test.ts

# Worker polling tests
SKIP_TESTCONTAINERS=true pnpm vitest run apps/worker/test/negative/poll-worker.negative.test.ts

# Signing error transformation tests (25 tests)
SKIP_TESTCONTAINERS=true pnpm vitest run apps/gateway/test/unit/signing-errors.test.ts

# Error normalizer unit tests (35 tests)
SKIP_TESTCONTAINERS=true pnpm vitest run packages/myinvois-client/src/error-normalizer.test.ts
```

#### Test Principles

- **No real network calls** - All tests use MSW mocks
- **Assert on normalized ErrorEnvelope** - Never assert on raw MyInvois payloads
- **Deterministic** - No random delays or flaky tests
- **No secrets in logs** - Test fixtures don't contain real credentials

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

This section provides step-by-step deployment guides for different architectures.

### Deployment Options Overview

| Architecture | Best For | Complexity | Scalability |
|--------------|----------|------------|-------------|
| **Monolith** | Small teams, startups, MVPs | Low | Vertical |
| **Microservices** | Enterprise, high-traffic | Medium-High | Horizontal |

---

### Option 1: Monolith Deployment (Single Server)

Deploy the gateway and worker as a single unit on one server. Ideal for:
- Small to medium businesses (< 10,000 invoices/month)
- Development and staging environments
- Quick proof-of-concept deployments

#### Step 1: Prepare Your Server

```bash
# Requirements: Ubuntu 22.04+ or similar Linux
# Minimum: 2 CPU cores, 4GB RAM, 20GB SSD

# Install Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Install Docker and Docker Compose
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
```

#### Step 2: Clone and Configure

```bash
# Clone the repository
git clone https://github.com/zahidaramai/MyInvoice-SDK-Middleware.git
cd myinvois-middleware

# Install dependencies
pnpm install

# Create production environment file
cp .env.example .env.production
```

#### Step 3: Configure Environment Variables

Edit `.env.production`:

```env
# Server Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# Database (PostgreSQL)
DATABASE_URL=postgresql://myinvois:your-secure-password@localhost:5432/myinvois_prod

# Redis
REDIS_URL=redis://localhost:6379

# MyInvois Credentials (from LHDN portal)
MYINVOIS_CLIENT_ID=your-client-id
MYINVOIS_CLIENT_SECRET_1=your-primary-secret
MYINVOIS_CLIENT_SECRET_2=your-backup-secret
MYINVOIS_ENV=PROD
MYINVOIS_SUPPLIER_TIN=your-tin
MYINVOIS_SUPPLIER_ID_TYPE=BRN
MYINVOIS_SUPPLIER_ID_VALUE=your-brn

# Document Signing (v1.1)
SIGNING_ENABLED=true
SIGNING_DEFAULT_VERSION=1.1
SIGNING_PKCS12_PATH=/opt/myinvois/certs/certificate.p12
SIGNING_PKCS12_PASSPHRASE=your-cert-password

# Metrics
METRICS_ENABLED=true
```

#### Step 4: Start Infrastructure Services

```bash
# Create docker-compose.monolith.yml
cat > docker-compose.monolith.yml << 'EOF'
version: '3.8'
services:
  db:
    image: postgres:16-alpine
    container_name: myinvois-db
    restart: always
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: myinvois_prod
      POSTGRES_USER: myinvois
      POSTGRES_PASSWORD: your-secure-password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myinvois"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: myinvois-redis
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
EOF

# Start database and Redis
docker compose -f docker-compose.monolith.yml up -d

# Wait for services to be ready
sleep 10
docker compose -f docker-compose.monolith.yml ps
```

#### Step 5: Build and Deploy Application

```bash
# Build the application
pnpm build

# Run database migrations
DATABASE_URL=postgresql://myinvois:your-secure-password@localhost:5432/myinvois_prod \
  pnpm --filter @myinvois/storage prisma migrate deploy

# Create systemd service for Gateway
sudo cat > /etc/systemd/system/myinvois-gateway.service << 'EOF'
[Unit]
Description=MyInvois Gateway
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/myinvois
EnvironmentFile=/opt/myinvois/.env.production
ExecStart=/usr/bin/node /opt/myinvois/apps/gateway/dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Create systemd service for Worker
sudo cat > /etc/systemd/system/myinvois-worker.service << 'EOF'
[Unit]
Description=MyInvois Worker
After=network.target myinvois-gateway.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/myinvois
EnvironmentFile=/opt/myinvois/.env.production
ExecStart=/usr/bin/node /opt/myinvois/apps/worker/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start services
sudo systemctl daemon-reload
sudo systemctl enable myinvois-gateway myinvois-worker
sudo systemctl start myinvois-gateway myinvois-worker
```

#### Step 6: Configure Nginx Reverse Proxy (Optional but Recommended)

```bash
# Install Nginx
sudo apt-get install -y nginx

# Configure Nginx
sudo cat > /etc/nginx/sites-available/myinvois << 'EOF'
upstream myinvois_gateway {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://myinvois_gateway;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # Health check endpoints (no auth)
    location /healthz {
        proxy_pass http://myinvois_gateway/healthz;
    }

    location /readyz {
        proxy_pass http://myinvois_gateway/readyz;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/myinvois /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

#### Step 7: Verify Deployment

```bash
# Check service status
sudo systemctl status myinvois-gateway
sudo systemctl status myinvois-worker

# Test health endpoints
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
curl http://localhost:3000/version

# View logs
sudo journalctl -u myinvois-gateway -f
sudo journalctl -u myinvois-worker -f
```

---

### Option 2: Microservices Deployment (Kubernetes)

Deploy as containerized microservices for high availability and horizontal scaling. Ideal for:
- Enterprise deployments (> 100,000 invoices/month)
- Multi-region deployments
- Teams with Kubernetes expertise

#### Step 1: Build Docker Images

```dockerfile
# Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps

RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN pnpm build

# Gateway image
FROM node:22-alpine AS gateway
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/gateway ./apps/gateway
EXPOSE 3000
CMD ["node", "apps/gateway/dist/server.js"]

# Worker image
FROM node:22-alpine AS worker
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker ./apps/worker
CMD ["node", "apps/worker/dist/index.js"]
```

```bash
# Build and push images
docker build --target gateway -t your-registry/myinvois-gateway:1.1.0 .
docker build --target worker -t your-registry/myinvois-worker:1.1.0 .
docker push your-registry/myinvois-gateway:1.1.0
docker push your-registry/myinvois-worker:1.1.0
```

#### Step 2: Create Kubernetes Secrets

```yaml
# k8s/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: myinvois-secrets
  namespace: myinvois
type: Opaque
stringData:
  DATABASE_URL: "postgresql://myinvois:password@postgres-service:5432/myinvois"
  REDIS_URL: "redis://redis-service:6379"
  MYINVOIS_CLIENT_ID: "your-client-id"
  MYINVOIS_CLIENT_SECRET_1: "your-primary-secret"
  MYINVOIS_CLIENT_SECRET_2: "your-backup-secret"
  SIGNING_PKCS12_PASSPHRASE: "your-cert-password"
---
apiVersion: v1
kind: Secret
metadata:
  name: myinvois-certs
  namespace: myinvois
type: Opaque
data:
  certificate.p12: <base64-encoded-p12-file>
```

#### Step 3: Deploy Gateway Service

```yaml
# k8s/gateway-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myinvois-gateway
  namespace: myinvois
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myinvois-gateway
  template:
    metadata:
      labels:
        app: myinvois-gateway
    spec:
      containers:
        - name: gateway
          image: your-registry/myinvois-gateway:1.1.0
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: myinvois-secrets
          env:
            - name: NODE_ENV
              value: "production"
            - name: SIGNING_ENABLED
              value: "true"
            - name: SIGNING_DEFAULT_VERSION
              value: "1.1"
            - name: SIGNING_PKCS12_PATH
              value: "/certs/certificate.p12"
          volumeMounts:
            - name: certs
              mountPath: /certs
              readOnly: true
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /readyz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
      volumes:
        - name: certs
          secret:
            secretName: myinvois-certs
---
apiVersion: v1
kind: Service
metadata:
  name: myinvois-gateway
  namespace: myinvois
spec:
  selector:
    app: myinvois-gateway
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myinvois-gateway-hpa
  namespace: myinvois
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myinvois-gateway
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

#### Step 4: Deploy Worker Service

```yaml
# k8s/worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myinvois-worker
  namespace: myinvois
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myinvois-worker
  template:
    metadata:
      labels:
        app: myinvois-worker
    spec:
      containers:
        - name: worker
          image: your-registry/myinvois-worker:1.1.0
          envFrom:
            - secretRef:
                name: myinvois-secrets
          env:
            - name: NODE_ENV
              value: "production"
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "250m"
```

#### Step 5: Deploy Ingress

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myinvois-ingress
  namespace: myinvois
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts:
        - api.your-domain.com
      secretName: myinvois-tls
  rules:
    - host: api.your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myinvois-gateway
                port:
                  number: 80
```

#### Step 6: Apply Kubernetes Resources

```bash
# Create namespace
kubectl create namespace myinvois

# Apply all resources
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/gateway-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/ingress.yaml

# Verify deployment
kubectl get pods -n myinvois
kubectl get services -n myinvois
kubectl logs -n myinvois -l app=myinvois-gateway -f
```

---

### Health Checks

Configure your orchestrator to use:

- **Liveness**: `GET /healthz` - Returns 200 if process is alive
- **Readiness**: `GET /readyz` - Returns 200 if DB and Redis are connected

---

## Integration Guide

This section explains how to integrate the MyInvois middleware with your existing applications.

### Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Your Application                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐   │
│  │ React/Vue/    │  │ NestJS/       │  │ PHP/Python/           │   │
│  │ Angular       │  │ Express       │  │ Java/.NET             │   │
│  │ Frontend      │  │ Backend       │  │ Backend               │   │
│  └───────┬───────┘  └───────┬───────┘  └───────────┬───────────┘   │
│          │                  │                      │                │
│          └──────────────────┼──────────────────────┘                │
│                             │                                        │
│                    HTTP/REST API Calls                              │
│                             │                                        │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   MyInvois Middleware Gateway                        │
│                   http://localhost:3000 (or your domain)            │
└─────────────────────────────────────────────────────────────────────┘
```

---

### React Frontend Integration

#### Step 1: Install HTTP Client

```bash
npm install axios
# or
yarn add axios
```

#### Step 2: Create API Service

```typescript
// src/services/myinvois.service.ts
import axios, { AxiosInstance, AxiosError } from 'axios';

interface Session {
  id: string;
  env: 'SANDBOX' | 'PROD';
  mode: 'TAXPAYER' | 'INTERMEDIARY';
  expiresAt: string;
}

interface SubmissionResult {
  trackingId: string;
  submissionUid: string;
  status: string;
  acceptedDocuments: Array<{ codeNumber: string; uuid: string }>;
  rejectedDocuments: Array<{ codeNumber: string; error: any }>;
}

interface ErrorEnvelope {
  error: {
    code: string;
    messageEN: string;
    httpStatus: number;
    retryable: boolean;
    retryAfterSeconds?: number;
  };
}

class MyInvoisService {
  private api: AxiosInstance;
  private sessionId: string | null = null;

  constructor(baseURL: string = 'http://localhost:3000') {
    this.api = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Response interceptor for error handling
    this.api.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ErrorEnvelope>) => {
        if (error.response?.data?.error) {
          const err = error.response.data.error;
          console.error(`[MyInvois Error] ${err.code}: ${err.messageEN}`);

          // Handle retryable errors
          if (err.retryable && err.retryAfterSeconds) {
            console.log(`Retry after ${err.retryAfterSeconds} seconds`);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Create a session (call once on app init or login)
  async createSession(credentials: {
    clientId: string;
    clientSecret: string;
    env: 'SANDBOX' | 'PROD';
    mode: 'TAXPAYER' | 'INTERMEDIARY';
    onBehalfOf?: string;
  }): Promise<Session> {
    const response = await this.api.post<Session>('/v1/sessions', credentials);
    this.sessionId = response.data.id;
    return response.data;
  }

  // Submit an invoice
  async submitInvoice(invoice: {
    format: 'JSON' | 'XML';
    document: string; // Base64 encoded
    documentHash: string; // SHA256 hash
    codeNumber: string;
  }): Promise<SubmissionResult> {
    if (!this.sessionId) {
      throw new Error('Session not created. Call createSession first.');
    }

    const response = await this.api.post<SubmissionResult>(
      '/v1/submissions',
      {
        sessionId: this.sessionId,
        documents: [invoice],
      }
    );
    return response.data;
  }

  // Check submission status
  async getSubmissionStatus(trackingId: string): Promise<SubmissionResult> {
    const response = await this.api.get<SubmissionResult>(
      `/v1/submissions/${trackingId}`,
      { params: { sessionId: this.sessionId } }
    );
    return response.data;
  }

  // Validate a TIN
  async validateTin(tin: string, idType: string, idValue: string): Promise<{
    valid: boolean;
    name?: string;
  }> {
    const response = await this.api.get('/v1/tin/validate', {
      params: { tin, idType, idValue, sessionId: this.sessionId },
    });
    return response.data;
  }

  // Cancel a document
  async cancelDocument(uuid: string, reason: string): Promise<void> {
    await this.api.post(`/v1/documents/${uuid}/cancel`, {
      sessionId: this.sessionId,
      reason,
    });
  }

  // Get session ID
  getSessionId(): string | null {
    return this.sessionId;
  }
}

export const myInvoisService = new MyInvoisService(
  process.env.REACT_APP_MYINVOIS_URL || 'http://localhost:3000'
);
```

#### Step 3: Create React Hook

```typescript
// src/hooks/useMyInvois.ts
import { useState, useCallback } from 'react';
import { myInvoisService } from '../services/myinvois.service';

export function useMyInvois() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitInvoice = useCallback(async (invoiceData: any) => {
    setLoading(true);
    setError(null);

    try {
      // Convert invoice to base64 and calculate hash
      const jsonString = JSON.stringify(invoiceData);
      const document = btoa(jsonString);
      const hashBuffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(jsonString)
      );
      const documentHash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const result = await myInvoisService.submitInvoice({
        format: 'JSON',
        document,
        documentHash,
        codeNumber: invoiceData.ID || `INV-${Date.now()}`,
      });

      return result;
    } catch (err: any) {
      const message = err.response?.data?.error?.messageEN || err.message;
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const validateTin = useCallback(async (tin: string, idType: string, idValue: string) => {
    setLoading(true);
    setError(null);

    try {
      return await myInvoisService.validateTin(tin, idType, idValue);
    } catch (err: any) {
      const message = err.response?.data?.error?.messageEN || err.message;
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    submitInvoice,
    validateTin,
    getSessionId: myInvoisService.getSessionId.bind(myInvoisService),
  };
}
```

#### Step 4: Use in Component

```tsx
// src/components/InvoiceForm.tsx
import React, { useState } from 'react';
import { useMyInvois } from '../hooks/useMyInvois';

export function InvoiceForm() {
  const { submitInvoice, loading, error } = useMyInvois();
  const [result, setResult] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const invoiceData = {
      ID: `INV-${Date.now()}`,
      IssueDate: new Date().toISOString().split('T')[0],
      InvoiceTypeCode: '01', // Standard invoice
      // ... your UBL invoice structure
    };

    try {
      const response = await submitInvoice(invoiceData);
      setResult(response);
      alert(`Invoice submitted! Tracking ID: ${response.trackingId}`);
    } catch (err) {
      console.error('Submission failed:', err);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
      <button type="submit" disabled={loading}>
        {loading ? 'Submitting...' : 'Submit Invoice'}
      </button>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="result">
          <p>Tracking ID: {result.trackingId}</p>
          <p>Status: {result.status}</p>
        </div>
      )}
    </form>
  );
}
```

---

### NestJS Backend Integration

#### Step 1: Install Dependencies

```bash
npm install axios @nestjs/config class-validator class-transformer
```

#### Step 2: Create MyInvois Module

```typescript
// src/myinvois/myinvois.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { MyInvoisService } from './myinvois.service';
import { MyInvoisController } from './myinvois.controller';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    ConfigModule,
  ],
  controllers: [MyInvoisController],
  providers: [MyInvoisService],
  exports: [MyInvoisService],
})
export class MyInvoisModule {}
```

#### Step 3: Create MyInvois Service

```typescript
// src/myinvois/myinvois.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, catchError } from 'rxjs';
import { AxiosError } from 'axios';
import * as crypto from 'crypto';

interface Session {
  id: string;
  env: string;
  mode: string;
  expiresAt: string;
}

interface SubmissionResult {
  trackingId: string;
  submissionUid: string;
  status: string;
  acceptedDocuments: Array<{ codeNumber: string; uuid: string }>;
  rejectedDocuments: Array<{ codeNumber: string; error: any }>;
}

@Injectable()
export class MyInvoisService implements OnModuleInit {
  private readonly logger = new Logger(MyInvoisService.name);
  private readonly baseUrl: string;
  private sessionId: string | null = null;
  private sessionExpiresAt: Date | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'MYINVOIS_MIDDLEWARE_URL',
      'http://localhost:3000',
    );
  }

  async onModuleInit() {
    // Initialize session on module startup
    await this.ensureSession();
  }

  private async ensureSession(): Promise<string> {
    // Check if session exists and is valid (with 5-minute buffer)
    if (
      this.sessionId &&
      this.sessionExpiresAt &&
      this.sessionExpiresAt > new Date(Date.now() + 5 * 60 * 1000)
    ) {
      return this.sessionId;
    }

    this.logger.log('Creating new MyInvois session...');

    const session = await this.createSession({
      clientId: this.configService.getOrThrow('MYINVOIS_CLIENT_ID'),
      clientSecret: this.configService.getOrThrow('MYINVOIS_CLIENT_SECRET'),
      env: this.configService.get('MYINVOIS_ENV', 'SANDBOX') as 'SANDBOX' | 'PROD',
      mode: 'TAXPAYER',
    });

    this.sessionId = session.id;
    this.sessionExpiresAt = new Date(session.expiresAt);
    this.logger.log(`Session created: ${this.sessionId}`);

    return this.sessionId;
  }

  async createSession(credentials: {
    clientId: string;
    clientSecret: string;
    env: 'SANDBOX' | 'PROD';
    mode: 'TAXPAYER' | 'INTERMEDIARY';
    onBehalfOf?: string;
  }): Promise<Session> {
    const response = await firstValueFrom(
      this.httpService.post<Session>(`${this.baseUrl}/v1/sessions`, credentials).pipe(
        catchError((error: AxiosError) => {
          this.logger.error('Failed to create session', error.response?.data);
          throw error;
        }),
      ),
    );
    return response.data;
  }

  async submitInvoice(invoiceData: {
    invoiceNumber: string;
    ublDocument: object;
  }): Promise<SubmissionResult> {
    const sessionId = await this.ensureSession();

    // Serialize and encode document
    const jsonString = JSON.stringify(invoiceData.ublDocument);
    const document = Buffer.from(jsonString).toString('base64');
    const documentHash = crypto.createHash('sha256').update(jsonString).digest('hex');

    const response = await firstValueFrom(
      this.httpService
        .post<SubmissionResult>(`${this.baseUrl}/v1/submissions`, {
          sessionId,
          documents: [
            {
              format: 'JSON',
              document,
              documentHash,
              codeNumber: invoiceData.invoiceNumber,
            },
          ],
        })
        .pipe(
          catchError((error: AxiosError) => {
            this.logger.error('Failed to submit invoice', error.response?.data);
            throw error;
          }),
        ),
    );

    return response.data;
  }

  async getSubmissionStatus(trackingId: string): Promise<SubmissionResult> {
    const sessionId = await this.ensureSession();

    const response = await firstValueFrom(
      this.httpService
        .get<SubmissionResult>(`${this.baseUrl}/v1/submissions/${trackingId}`, {
          params: { sessionId },
        })
        .pipe(
          catchError((error: AxiosError) => {
            this.logger.error('Failed to get submission status', error.response?.data);
            throw error;
          }),
        ),
    );

    return response.data;
  }

  async validateTin(
    tin: string,
    idType: 'NRIC' | 'BRN' | 'PASSPORT' | 'ARMY',
    idValue: string,
  ): Promise<{ valid: boolean; name?: string }> {
    const sessionId = await this.ensureSession();

    const response = await firstValueFrom(
      this.httpService
        .get(`${this.baseUrl}/v1/tin/validate`, {
          params: { tin, idType, idValue, sessionId },
        })
        .pipe(
          catchError((error: AxiosError) => {
            this.logger.error('Failed to validate TIN', error.response?.data);
            throw error;
          }),
        ),
    );

    return response.data;
  }

  async cancelDocument(uuid: string, reason: string): Promise<void> {
    const sessionId = await this.ensureSession();

    await firstValueFrom(
      this.httpService
        .post(`${this.baseUrl}/v1/documents/${uuid}/cancel`, {
          sessionId,
          reason,
        })
        .pipe(
          catchError((error: AxiosError) => {
            this.logger.error('Failed to cancel document', error.response?.data);
            throw error;
          }),
        ),
    );
  }
}
```

#### Step 4: Create Controller

```typescript
// src/myinvois/myinvois.controller.ts
import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { MyInvoisService } from './myinvois.service';

class SubmitInvoiceDto {
  invoiceNumber: string;
  ublDocument: object;
}

class ValidateTinDto {
  tin: string;
  idType: 'NRIC' | 'BRN' | 'PASSPORT' | 'ARMY';
  idValue: string;
}

@Controller('invoices')
export class MyInvoisController {
  constructor(private readonly myInvoisService: MyInvoisService) {}

  @Post('submit')
  async submitInvoice(@Body() dto: SubmitInvoiceDto) {
    return this.myInvoisService.submitInvoice({
      invoiceNumber: dto.invoiceNumber,
      ublDocument: dto.ublDocument,
    });
  }

  @Get('status/:trackingId')
  async getStatus(@Param('trackingId') trackingId: string) {
    return this.myInvoisService.getSubmissionStatus(trackingId);
  }

  @Get('validate-tin')
  async validateTin(@Query() query: ValidateTinDto) {
    return this.myInvoisService.validateTin(query.tin, query.idType, query.idValue);
  }

  @Post(':uuid/cancel')
  async cancelInvoice(
    @Param('uuid') uuid: string,
    @Body('reason') reason: string,
  ) {
    await this.myInvoisService.cancelDocument(uuid, reason);
    return { success: true };
  }
}
```

#### Step 5: Add Environment Configuration

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MyInvoisModule } from './myinvois/myinvois.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    MyInvoisModule,
  ],
})
export class AppModule {}
```

```env
# .env
MYINVOIS_MIDDLEWARE_URL=http://localhost:3000
MYINVOIS_CLIENT_ID=your-client-id
MYINVOIS_CLIENT_SECRET=your-client-secret
MYINVOIS_ENV=SANDBOX
```

---

### Generic HTTP Integration (Any Platform)

For any platform or language, integrate using standard HTTP requests:

#### API Flow

```
1. Create Session (POST /v1/sessions)
   ↓
2. Store session ID
   ↓
3. Submit Invoice (POST /v1/submissions with sessionId)
   ↓
4. Poll Status (GET /v1/submissions/{trackingId})
   ↓
5. Handle Result (success or retry)
```

#### cURL Examples

```bash
# 1. Create a session
SESSION_RESPONSE=$(curl -s -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "env": "SANDBOX",
    "mode": "TAXPAYER"
  }')

SESSION_ID=$(echo $SESSION_RESPONSE | jq -r '.id')
echo "Session ID: $SESSION_ID"

# 2. Submit an invoice
INVOICE_JSON='{"ID":"INV-001","IssueDate":"2024-01-15"}'
DOCUMENT_BASE64=$(echo -n $INVOICE_JSON | base64)
DOCUMENT_HASH=$(echo -n $INVOICE_JSON | sha256sum | cut -d' ' -f1)

SUBMISSION_RESPONSE=$(curl -s -X POST http://localhost:3000/v1/submissions \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"$SESSION_ID\",
    \"documents\": [{
      \"format\": \"JSON\",
      \"document\": \"$DOCUMENT_BASE64\",
      \"documentHash\": \"$DOCUMENT_HASH\",
      \"codeNumber\": \"INV-001\"
    }]
  }")

TRACKING_ID=$(echo $SUBMISSION_RESPONSE | jq -r '.trackingId')
echo "Tracking ID: $TRACKING_ID"

# 3. Check status
curl -s "http://localhost:3000/v1/submissions/$TRACKING_ID?sessionId=$SESSION_ID" | jq

# 4. Validate a TIN
curl -s "http://localhost:3000/v1/tin/validate?tin=C12345678901&idType=BRN&idValue=202001234567&sessionId=$SESSION_ID" | jq
```

#### PHP Example

```php
<?php
class MyInvoisClient {
    private $baseUrl;
    private $sessionId;

    public function __construct($baseUrl = 'http://localhost:3000') {
        $this->baseUrl = $baseUrl;
    }

    public function createSession($clientId, $clientSecret, $env = 'SANDBOX') {
        $response = $this->request('POST', '/v1/sessions', [
            'clientId' => $clientId,
            'clientSecret' => $clientSecret,
            'env' => $env,
            'mode' => 'TAXPAYER'
        ]);
        $this->sessionId = $response['id'];
        return $response;
    }

    public function submitInvoice($invoiceData, $codeNumber) {
        $json = json_encode($invoiceData);
        $document = base64_encode($json);
        $hash = hash('sha256', $json);

        return $this->request('POST', '/v1/submissions', [
            'sessionId' => $this->sessionId,
            'documents' => [[
                'format' => 'JSON',
                'document' => $document,
                'documentHash' => $hash,
                'codeNumber' => $codeNumber
            ]]
        ]);
    }

    public function getStatus($trackingId) {
        return $this->request('GET', "/v1/submissions/{$trackingId}?sessionId={$this->sessionId}");
    }

    private function request($method, $path, $data = null) {
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode >= 400) {
            throw new Exception("HTTP Error: $httpCode - $response");
        }

        return json_decode($response, true);
    }
}

// Usage
$client = new MyInvoisClient('http://localhost:3000');
$client->createSession('your-client-id', 'your-secret', 'SANDBOX');
$result = $client->submitInvoice(['ID' => 'INV-001'], 'INV-001');
echo "Tracking ID: " . $result['trackingId'];
?>
```

#### Python Example

```python
import requests
import base64
import hashlib
import json

class MyInvoisClient:
    def __init__(self, base_url='http://localhost:3000'):
        self.base_url = base_url
        self.session_id = None

    def create_session(self, client_id, client_secret, env='SANDBOX'):
        response = requests.post(f'{self.base_url}/v1/sessions', json={
            'clientId': client_id,
            'clientSecret': client_secret,
            'env': env,
            'mode': 'TAXPAYER'
        })
        response.raise_for_status()
        data = response.json()
        self.session_id = data['id']
        return data

    def submit_invoice(self, invoice_data, code_number):
        json_str = json.dumps(invoice_data)
        document = base64.b64encode(json_str.encode()).decode()
        document_hash = hashlib.sha256(json_str.encode()).hexdigest()

        response = requests.post(f'{self.base_url}/v1/submissions', json={
            'sessionId': self.session_id,
            'documents': [{
                'format': 'JSON',
                'document': document,
                'documentHash': document_hash,
                'codeNumber': code_number
            }]
        })
        response.raise_for_status()
        return response.json()

    def get_status(self, tracking_id):
        response = requests.get(
            f'{self.base_url}/v1/submissions/{tracking_id}',
            params={'sessionId': self.session_id}
        )
        response.raise_for_status()
        return response.json()

# Usage
client = MyInvoisClient('http://localhost:3000')
client.create_session('your-client-id', 'your-secret', 'SANDBOX')
result = client.submit_invoice({'ID': 'INV-001'}, 'INV-001')
print(f"Tracking ID: {result['trackingId']}")
```

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

## Issue Document Script

The `scripts/issue-document.ts` script provides a comprehensive tool for testing all 9 MyInvois document types with both v1.0 (unsigned) and v1.1 (signed) formats.

### Supported Document Types

| Type | Code | Command | Reference Required |
|------|------|---------|-------------------|
| Invoice | 01 | `--type invoice` | No |
| Consolidated Invoice | 01 | `--type consolidated` | No |
| Credit Note | 02 | `--type credit-note` | Yes |
| Debit Note | 03 | `--type debit-note` | Yes |
| Refund Note | 04 | `--type refund-note` | Yes |
| Self-billed Invoice | 11 | `--type self-billed-invoice` | No |
| Self-billed Credit Note | 12 | `--type self-billed-credit` | Yes |
| Self-billed Debit Note | 13 | `--type self-billed-debit` | Yes |
| Self-billed Refund Note | 14 | `--type self-billed-refund` | Yes |

### Basic Usage

```bash
# Install dependencies
pnpm install

# Basic invoice (v1.1 signed by default)
pnpm tsx scripts/issue-document.ts --type invoice --amount 100

# Invoice without signing (v1.0)
pnpm tsx scripts/issue-document.ts --type invoice --version 1.0 --amount 100

# Consolidated invoice (for general public)
pnpm tsx scripts/issue-document.ts --type consolidated --amount 1000

# Credit note (requires reference to original invoice)
pnpm tsx scripts/issue-document.ts --type credit-note --amount 50 \
  --ref-id INV-123 --ref-uuid <original-uuid>

# Self-billed invoice
pnpm tsx scripts/issue-document.ts --type self-billed-invoice --amount 200
```

### Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--type`, `-t` | Document type (see table above) | `invoice` |
| `--amount`, `-a` | Amount in MYR | `1.00` |
| `--version`, `-v` | API version: `1.0` or `1.1` | `1.1` |
| `--buyer-tin` | Buyer TIN | Supplier TIN |
| `--buyer-id` | Buyer ID value | Supplier ID |
| `--buyer-id-type` | `NRIC`, `PASSPORT`, `BRN`, `ARMY` | `BRN` |
| `--buyer-name` | Buyer name | `TEST BUYER` |
| `--ref-id` | Reference invoice ID | Required for adjustments |
| `--ref-uuid` | Reference invoice UUID | Required for adjustments |

### Document Type Notes

**Consolidated Invoice**: For aggregating multiple transactions to general public. Automatically uses:
- Buyer TIN: `EI00000000010` (general public)
- Buyer ID: `NA` with type `BRN`
- Classification Code: `004` (required by MyInvois)

**Credit/Debit/Refund Notes**: Require `--ref-id` and `--ref-uuid` pointing to the original invoice being adjusted.

**Self-billed Documents**: The buyer issues documents on behalf of the supplier. Same reference rules apply for adjustments (12-14).

### Validated Test Results

All 9 document types have been tested against the MyInvois Sandbox API and returned valid longIDs:

| Document Type | Version | Status | Long ID |
|---------------|---------|--------|---------|
| Invoice | v1.1 | Valid | `Y2CVNC04CYN4A0GNQ9K2EDFK10QSNKkR1768903757` |
| Invoice | v1.0 | Valid | `CHC5ED80WVS7H8S56A73EDFK10FFmz7S1768903777` |
| Consolidated Invoice | v1.1 | Valid | `D621DNBNW4R27FSBB5G3EDFK101R74Oz1768903786` |
| Credit Note | v1.1 | Valid | `ARXEV9JNZNQC62C2EMV3EDFK10FBMgpP1768903798` |
| Debit Note | v1.1 | Valid | `2Q20CC8XT3BZ0R208C54EDFK10pNIMOT1768903808` |
| Refund Note | v1.1 | Valid | `72QA8J9TK5HGZ0N233E4EDFK10LONYQQ1768903817` |
| Self-billed Invoice | v1.1 | Valid | `Z68Z0EEYFADNVZ1AR2Q4EDFK10BVhGZm1768903826` |
| Self-billed Credit Note | v1.1 | Valid | `GEMFH67Z1QC97QWZQP05EDFK10ERihN81768903836` |
| Self-billed Debit Note | v1.1 | Valid | `RXHY2K60A6TK9JBF3X95EDFK107A53O61768903845` |
| Self-billed Refund Note | v1.1 | Valid | `MT1YZSVNAKRA6CP8DQJ5EDFK10q7By3U1768903854` |

### Environment Requirements

```env
# Required for v1.1 signing
SIGNING_PKCS12_PATH=/path/to/certificate.p12
SIGNING_PKCS12_PASSPHRASE=your-passphrase

# MyInvois credentials
MYINVOIS_CLIENT_ID=your-client-id
MYINVOIS_CLIENT_SECRET_1=your-secret
MYINVOIS_SUPPLIER_TIN=your-tin
MYINVOIS_SUPPLIER_ID_TYPE=BRN
MYINVOIS_SUPPLIER_ID_VALUE=your-brn
MYINVOIS_ENV=SANDBOX
```

### Common Validation Errors

| Error | Cause | Solution |
|-------|-------|----------|
| ERR202 | Dummy NRIC with general TIN | Use BRN type or real buyer ID |
| ERR236 | Wrong classification with general TIN | Use classification code `004` |
| DS300/DS301 | Invalid signature | Check v1.1 signing format |

See [docs/document-types.md](docs/document-types.md) for detailed documentation on all document types.

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
- [Testing Guide](docs/testing.md) - Detailed testing strategy and MSW usage
- [Troubleshooting Guide](docs/troubleshooting.md) - Error codes reference and debugging
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
