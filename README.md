# MyInvois Middleware Gateway

[![CI](https://github.com/zahidaramai/MyInvoice-SDK-Middleware/actions/workflows/ci.yml/badge.svg)](https://github.com/zahidaramai/MyInvoice-SDK-Middleware/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma&logoColor=white)

![MyInvois Middleware Gateway](asset/social-preview.png)

**Open-source middleware gateway for Malaysia's MyInvois e-invoicing system.** A production-ready REST API layer between your applications and the official LHDN MyInvois API, handling authentication, digital signing, document submission, status polling, and multi-tenant management.

### Validated with Both v1.0 and v1.1

This middleware has been **validated against the MyInvois Sandbox and Production APIs** with all 9 document types in both **v1.0 (unsigned)** and **v1.1 (digitally signed)** formats:

| Document Type | v1.0 | v1.1 (Signed) |
|---------------|:----:|:-------------:|
| Invoice (01) | Validated | Validated |
| Credit Note (02) | Validated | Validated |
| Debit Note (03) | Validated | Validated |
| Refund Note (04) | Validated | Validated |
| Self-billed Invoice (11) | Validated | Validated |
| Self-billed Credit Note (12) | Validated | Validated |
| Self-billed Debit Note (13) | Validated | Validated |
| Self-billed Refund Note (14) | Validated | Validated |
| Consolidated Invoice | Validated | Validated |

> **Disclaimer**: This is an unofficial community project and is not affiliated with LHDN (Lembaga Hasil Dalam Negeri Malaysia). See [DISCLAIMER.md](DISCLAIMER.md) for full terms.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [API Reference](#api-reference)
  - [Authentication](#authentication-endpoints)
  - [Submission Endpoints](#submission-endpoints)
  - [Document Operations](#document-endpoints)
  - [Management APIs](#management-endpoints)
  - [Health & Monitoring](#health--monitoring)
- [Digital Signing (v1.1)](#digital-signing-v11)
- [Permissions & Roles](#permissions--roles)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Postman Collection](#postman-collection)
- [Generated SDKs](#generated-sdks)
- [Testing](#testing)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Features

| Feature | Description |
|---------|-------------|
| **4 Submission Types** | Consolidated B2C, JustSave (draft), B2B (buyer TIN+BRN), B2C (buyer NRIC) |
| **JWT Authentication** | Access + Refresh tokens with role-based access control |
| **Multi-Tenant Companies** | Full company management with MyInvois credential storage |
| **User Management** | Users, Roles, Companies CRUD with permission gating |
| **Document Operations** | List, Status, PDF, Cancel, QR Code, Share Links |
| **Digital Signing v1.1** | X.509 PKCS#12 certificate signing per LHDN specification |
| **Auto Status Polling** | Background polling for submission status updates |
| **Monthly Consolidation** | Scheduled consolidation of draft B2C invoices |
| **Draft Management** | Save, edit, update, and submit draft invoices |
| **Rate Limiting** | Built-in LHDN rate limit enforcement (12/100/300 RPM) |
| **ERP On-Behalf Mode** | Single ERP credentials for multiple suppliers |
| **POS Integration** | Dedicated POS adapter with QR e-invoice registration |
| **S3 Certificate Loading** | Load P12 certificates from AWS S3 or local paths |
| **Prometheus Metrics** | Built-in `/metrics` endpoint for monitoring |
| **Error Normalization** | Consistent error envelope with correlationId tracking |
| **4 Generated SDKs** | TypeScript, Python, Java, C# clients from OpenAPI spec |

---

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for local PostgreSQL and Redis)

### 1. Clone & Install

```bash
git clone https://github.com/zahidaramai/MyInvoice-SDK-Middleware.git
cd MyInvoice-SDK-Middleware
pnpm install
```

### 2. Start Infrastructure

```bash
docker compose -f docker/docker-compose.yml up -d
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your MyInvois credentials and database settings
```

### 4. Run Migrations & Seed

```bash
pnpm --filter @myinvois/storage prisma migrate dev
pnpm --filter @myinvois/storage prisma db seed
```

### 5. Start Gateway

```bash
pnpm --filter @myinvois/gateway dev
```

Gateway available at `http://localhost:3000`

### 6. Test Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│                 │     │    MyInvois Gateway       │     │                 │
│  Your Dashboard │────>│  ┌──────────────────┐    │────>│  MyInvois API   │
│  (React/Vue)    │     │  │ JWT Auth         │    │     │  (LHDN)         │
│                 │     │  │ RBAC             │    │     │                 │
└─────────────────┘     │  │ Rate Limiting    │    │     └─────────────────┘
                        │  │ Digital Signing  │    │
┌─────────────────┐     │  │ JSON -> UBL 2.1  │    │
│  POS System     │────>│  │ Error Normalizer │    │
│                 │     │  └──────────────────┘    │
└─────────────────┘     └────────────┬─────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │  Background Workers       │
                        │  - Auto Status Poller     │
                        │  - Monthly Consolidation  │
                        └────────────┬─────────────┘
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
   ┌──────▼──────┐           ┌───────▼───────┐          ┌──────▼──────┐
   │  PostgreSQL │           │    Redis      │          │  Prometheus │
   │  (Prisma)   │           │  (BullMQ +    │          │  (Metrics)  │
   │  10 models  │           │   Rate Limit) │          │             │
   └─────────────┘           └───────────────┘          └─────────────┘
```

---

## API Reference

### Base URL

```
http://localhost:3000/api/v1
```

All endpoints below are relative to the base URL. All endpoints except `/auth/login` require a JWT bearer token:

```
Authorization: Bearer <access_token>
```

---

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/logout` | Invalidate tokens |
| POST | `/auth/refresh` | Exchange refresh token for new access token |
| GET | `/auth/me` | Get current authenticated user |
| POST | `/auth/switch-company` | Switch active company context |

#### Login Response

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900,
  "user": {
    "id": "abc123",
    "email": "admin@example.com",
    "name": "Admin",
    "role": "Admin"
  }
}
```

---

### Submission Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/klcubelhdn/submit-consolidate` | Consolidated B2C invoice (daily sales) |
| POST | `/klcubelhdn/submit-justsave` | Save invoice as draft (no LHDN submission) |
| POST | `/klcubelhdn/submit-buyer` | B2B invoice (with buyer TIN + BRN) |
| POST | `/klcubelhdn/submit-personal` | B2C invoice (with buyer NRIC) |

#### Legacy Unified Endpoint

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/documents/submit` | Unified submission with flags |

#### Submission Request Format

```json
POST /api/v1/klcubelhdn/submit-buyer
{
  "companyId": "uuid-of-company",
  "documentVersion": "1.1",
  "invoices": [{
    "invoiceNumber": "INV-2026-001",
    "invoiceDate": "2026-01-21T10:00:00Z",
    "amount": 100.00,
    "discount": 0,
    "rounding": 0,
    "taxAmount": 8.00,
    "total": 108.00,
    "buyer": {
      "tin": "C25235029040",
      "name": "Buyer Company Sdn Bhd",
      "idType": "BRN",
      "idValue": "20170104319",
      "address": "123 Main Street",
      "city": "Kuala Lumpur",
      "state": "14",
      "postalCode": "50000",
      "phone": "0123456789",
      "email": "buyer@example.com"
    },
    "items": [{
      "description": "Professional Services",
      "quantity": 1,
      "unitPrice": 100.00,
      "discount": 0,
      "taxCode": "01",
      "taxRate": 8,
      "taxAmount": 8.00,
      "total": 108.00
    }]
  }]
}
```

---

### Document Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/documents` | List documents (with filters, pagination) |
| GET | `/documents/:uuid/status` | Get document status from MyInvois |
| GET | `/documents/:uuid/pdf` | Download PDF |
| POST | `/documents/:uuid/cancel` | Cancel submitted document |
| GET | `/documents/:uuid/qr` | Generate QR code (PNG) |
| GET | `/documents/:uuid/links` | Get all shareable links |
| POST | `/documents/:trackingId/submit` | Submit a saved draft |
| PUT | `/documents/:trackingId` | Update draft invoice data |
| DELETE | `/documents/:trackingId` | Delete draft invoice |
| GET | `/klcubelhdn/invoices/:trackingId` | Get full invoice details |

#### List Documents

```
GET /api/v1/documents?companyId=xxx&status=VALID&page=1&limit=20
```

#### Document Status Values

| Status | Description |
|--------|-------------|
| `DRAFT` | Saved locally, not submitted |
| `PENDING` | Queued for submission |
| `SUBMITTED` | Sent to MyInvois, awaiting validation |
| `VALID` | Accepted by LHDN |
| `INVALID` | Rejected by LHDN |
| `CANCELLED` | Cancelled after validation |

---

### Management Endpoints

#### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List all users (paginated) |
| POST | `/users` | Create user |
| GET | `/users/:id` | Get user by ID |
| PUT | `/users/:id` | Update user |
| DELETE | `/users/:id` | Delete user |
| PUT | `/users/:id/role` | Assign role to user |
| POST | `/users/:userId/companies/:companyId` | Link user to company |
| DELETE | `/users/:userId/companies/:companyId` | Unlink user from company |

#### Roles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/roles` | List all roles (paginated) |
| GET | `/roles/all` | Get all roles (for dropdowns) |
| GET | `/roles/permissions` | Get available permissions |
| POST | `/roles` | Create role |
| GET | `/roles/:id` | Get role by ID |
| PUT | `/roles/:id` | Update role |
| DELETE | `/roles/:id` | Delete role |

#### Companies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/companies` | List companies (paginated) |
| GET | `/companies/all` | Get all companies (for dropdowns) |
| POST | `/companies` | Create company |
| GET | `/companies/:id` | Get company details |
| PUT | `/companies/:id` | Update company |
| DELETE | `/companies/:id` | Delete company |
| PUT | `/companies/:id/credentials` | Set MyInvois API credentials |

#### POS Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/pos/register` | Register invoice for public QR sharing |
| POST | `/pos/invoices` | Bulk POS invoice upload |
| GET | `/pos/transactions` | Fetch POS transactions |

#### Public Routes (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/public/:posInvoiceId` | Public e-invoice registration page |

---

### Health & Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Basic health check |
| GET | `/healthz` | Kubernetes liveness probe |
| GET | `/readyz` | Readiness probe (DB + Redis) |
| GET | `/metrics` | Prometheus metrics |
| GET | `/version` | Version info |

---

## Digital Signing (v1.1)

Documents submitted with `documentVersion: "1.1"` are automatically signed using X.509 certificates per LHDN specification.

### Certificate Setup

**Option 1: Local PKCS#12 File**
```env
SIGNING_ENABLED=true
SIGNING_DEFAULT_VERSION=1.1
SIGNING_PKCS12_PATH=/path/to/certificate.p12
SIGNING_PKCS12_PASSPHRASE=your-password
```

**Option 2: AWS S3**
```env
SIGNING_PKCS12_PATH=s3://your-bucket/certificates/signing.p12
SIGNING_PKCS12_PASSPHRASE=your-password
```

**Option 3: PEM Files**
```env
SIGNING_CERT_PATH=/path/to/cert.pem
SIGNING_KEY_PATH=/path/to/key.pem
SIGNING_KEY_PASSPHRASE=your-password
```

### Signing Process

1. Gateway receives document with `documentVersion: "1.1"`
2. Calculates document hash (SHA-256)
3. Signs hash with RSA-SHA256 using private key
4. Injects UBL XAdES signature into document
5. Submits signed document to MyInvois

---

## Permissions & Roles

Role-based access control with **6 permissions**:

| Permission | Description | Endpoints |
|------------|-------------|-----------|
| `submit:invoice` | Submit invoices to LHDN | `/klcubelhdn/*`, `/documents/submit` |
| `read:documents` | View documents and statuses | `/documents`, `/documents/:uuid/*` |
| `cancel:documents` | Cancel submitted documents | `/documents/:uuid/cancel` |
| `manage:users` | User CRUD operations | `/users/*` |
| `manage:roles` | Role CRUD operations | `/roles/*` |
| `manage:companies` | Company CRUD operations | `/companies/*` |

### Default Roles (Pre-seeded)

| Role | Permissions |
|------|-------------|
| **Admin** | All 6 permissions |
| **Invoice Manager** | `submit:invoice`, `read:documents`, `cancel:documents` |
| **Viewer** | `read:documents` |

Custom roles can be created via the API using any combination of the 6 permissions.

---

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Access token signing key (64 hex chars) |
| `JWT_REFRESH_SECRET` | Refresh token signing key (64 hex chars) |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment mode |
| `LOG_LEVEL` | debug | Logging level (debug/info/warn/error) |
| `JWT_ACCESS_EXPIRY` | 15m | Access token TTL |
| `JWT_REFRESH_EXPIRY` | 7d | Refresh token TTL |
| `MYINVOIS_ENV` | SANDBOX | MyInvois environment (SANDBOX/PROD) |
| `SIGNING_ENABLED` | false | Enable v1.1 document signing |
| `SIGNING_DEFAULT_VERSION` | 1.0 | Default document version |
| `SIGNING_PKCS12_PATH` | - | Path to P12 certificate |
| `SIGNING_PKCS12_PASSPHRASE` | - | P12 passphrase |
| `ERP_MODE` | false | Enable ERP intermediary mode |
| `ENABLE_MONTHLY_CONSOLIDATION` | false | Enable monthly draft consolidation |
| `METRICS_ENABLED` | true | Enable Prometheus metrics |

### Generate Secure Secrets

```bash
openssl rand -hex 32
```

---

## Deployment

### Option 1: Docker Compose

```bash
cp .env.production.template .env
# Edit .env with production values

docker compose -f docker/docker-compose.prod.yml up -d
docker compose exec gateway npx prisma migrate deploy
```

### Option 2: AWS Elastic Beanstalk

Full guide: [documentation/AWS-EB-DEPLOYMENT-GUIDE.md](documentation/AWS-EB-DEPLOYMENT-GUIDE.md)

```bash
./scripts/deploy-eb.sh v1.0.0
```

### Option 3: Docker (Standalone)

```bash
docker build -t myinvois-gateway .
docker run -p 3000:3000 --env-file .env myinvois-gateway
```

---

## Postman Collection

A comprehensive Postman collection is included with pre-built requests for all API endpoints.

### Import

```
documentation/KLCubeLHDN-API-v1.1.2.postman_collection.json
```

1. Open Postman > **Import** > Upload the collection file
2. Set `baseUrl` variable to your API URL
3. Run "Login" first to get tokens
4. All subsequent requests use the token automatically

---

## Generated SDKs

Auto-generated client SDKs from the OpenAPI specification:

| Language | Location |
|----------|----------|
| TypeScript | `sdks/typescript/` |
| Python | `sdks/python/` |
| Java | `sdks/java/` |
| C# / .NET | `sdks/dotnet/` |

OpenAPI spec: `documentation/openapi.yaml`

---

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test -- --coverage

# Run linting + type check + tests + build
pnpm check

# Run specific test file
pnpm --filter @myinvois/gateway test -- signing.test.ts
```

### Test Structure

| Type | Location |
|------|----------|
| Unit tests | `packages/*/test/` |
| Route tests | `apps/gateway/src/routes/**/*.test.ts` |
| Integration tests | `test/integration/` |
| E2E tests | `test/e2e/` |
| Negative tests | `apps/gateway/test/negative/` |
| Contract tests | `test/openapi/` |

---

## Project Structure

```
MyInvoice-SDK-Middleware/
├── apps/
│   ├── gateway/                 # REST API (Fastify)
│   │   ├── src/
│   │   │   ├── adapters/        # KLCubeLHDN + POS adapters
│   │   │   ├── auth/            # JWT authentication
│   │   │   ├── management/      # User/Role/Company CRUD
│   │   │   ├── polling/         # Auto status poller + consolidation
│   │   │   ├── public/          # Public QR registration
│   │   │   ├── config/          # Signing, S3 loader
│   │   │   ├── plugins/         # Fastify plugins
│   │   │   └── routes/          # Core v1 routes
│   │   ├── prisma/              # Database schema + migrations
│   │   └── test/                # Gateway tests
│   └── worker/                  # Background job processor (BullMQ)
├── packages/
│   ├── contracts/               # Shared TypeScript types
│   ├── core/                    # Rate limiter, error normalization
│   ├── myinvois-client/         # Typed MyInvois API client
│   ├── signing/                 # X.509 signing (v1.1)
│   └── storage/                 # Prisma ORM + PostgreSQL
├── sdks/                        # Generated client SDKs
│   ├── typescript/
│   ├── python/
│   ├── java/
│   └── dotnet/
├── docker/                      # Docker Compose configs
├── documentation/               # OpenAPI spec, deployment guides
├── scripts/                     # Build + deploy scripts
├── test/                        # E2E + integration tests
└── Dockerfile                   # Multi-stage production build
```

---

## Database Models

| Model | Purpose |
|-------|---------|
| `User` | Platform user accounts |
| `Role` | Roles with permission arrays |
| `Company` | Multi-tenant company entities with MyInvois credentials |
| `UserCompany` | User-Company many-to-many linking |
| `RefreshToken` | JWT refresh token tracking |
| `Invoice` | Invoice storage with full lifecycle |
| `Submission` | Gateway submission tracking |
| `SubmissionDocument` | Individual documents within submissions |
| `IdempotencyWindow` | 10-minute deduplication window |
| `TinValidateCache` | TIN validation result caching |

---

## Tax Codes

| Code | Description |
|------|-------------|
| 01 | Sales Tax (SST) |
| 02 | Service Tax |
| 03 | Tourism Tax |
| 04 | High-Value Goods Tax |
| 05 | Sales Tax on Low Value Goods |
| 06 | Not Applicable |
| E | Tax Exemption |

## State Codes

| Code | State |
|------|-------|
| 01 | Johor |
| 02 | Kedah |
| 03 | Kelantan |
| 04 | Melaka |
| 05 | Negeri Sembilan |
| 06 | Pahang |
| 07 | Pulau Pinang |
| 08 | Perak |
| 09 | Perlis |
| 10 | Selangor |
| 11 | Terengganu |
| 12 | Sabah |
| 13 | Sarawak |
| 14 | Kuala Lumpur |
| 15 | Labuan |
| 16 | Putrajaya |
| 17 | Not Applicable |

---

## Security

### Best Practices

1. Use strong JWT secrets (64+ hex characters)
2. Enable HTTPS in production (via reverse proxy or load balancer)
3. Restrict database access to minimum required
4. Enable database encryption at rest
5. Rotate secrets regularly
6. Monitor application logs for anomalies

### CORS

Currently allows all origins. To restrict, modify `apps/gateway/src/app.ts`:

```typescript
cors({
  origin: ["https://your-domain.com"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
})
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **401 Unauthorized** | Token expired - use `/auth/refresh` for new token |
| **403 Forbidden** | Missing permissions or user not linked to company |
| **429 Too Many Requests** | Rate limit hit - respect `Retry-After` header |
| **Certificate Errors** | Verify `SIGNING_PKCS12_PATH` and passphrase |
| **Database Connection** | Check `DATABASE_URL` and PostgreSQL is running |

### Debug Commands

```bash
# Local dev with verbose logging
LOG_LEVEL=debug pnpm --filter @myinvois/gateway dev

# Test health
curl http://localhost:3000/health

# Docker logs
docker compose logs -f gateway
```

---

## Commands Reference

```bash
# Development
pnpm install                              # Install all dependencies
pnpm --filter @myinvois/gateway dev       # Start gateway (hot reload)
pnpm build                                # Build all packages
pnpm check                                # Lint + typecheck + test + build

# Testing
pnpm test                                 # Run all tests
pnpm test -- --coverage                   # With coverage

# Database
pnpm --filter @myinvois/storage prisma migrate dev    # Run migrations
pnpm --filter @myinvois/storage prisma generate       # Generate client
pnpm --filter @myinvois/storage prisma db seed        # Seed database
pnpm --filter @myinvois/storage prisma studio         # Open Prisma Studio

# OpenAPI
npx @stoplight/spectral-cli lint documentation/openapi.yaml
```

---

## Resources

### External References

- [MyInvois SDK Documentation](https://sdk.myinvois.hasil.gov.my/)
- [Submit Documents API](https://sdk.myinvois.hasil.gov.my/einvoicingapi/02-submit-documents/)
- [Get Submission API](https://sdk.myinvois.hasil.gov.my/einvoicingapi/06-get-submission/)
- [Standard Error Response](https://sdk.myinvois.hasil.gov.my/standard-error-response/)
- [JSON Digital Signature](https://sdk.myinvois.hasil.gov.my/signature-creation-json/)

### Project Documentation

- [OpenAPI Specification](documentation/openapi.yaml)
- [Postman Collection](documentation/KLCubeLHDN-API-v1.1.2.postman_collection.json)
- [AWS EB Deployment Guide](documentation/AWS-EB-DEPLOYMENT-GUIDE.md)
- [Docker Deployment Guide](documentation/DEPLOYMENT.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Disclaimer](DISCLAIMER.md)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Ensure tests pass (`pnpm check`)
4. Commit your changes
5. Push to the branch
6. Open a Pull Request

---

## Developer

**Zahid Aramai** - Full-Stack Developer & System Architect

| | |
|---|---|
| **Website** | [zahidaramai.com](https://zahidaramai.com) |
| **Email** | hello@zahidaramai.com |
| **GitHub** | [@zahidaramai](https://github.com/zahidaramai) |

---

## License

[MIT License](LICENSE) - see LICENSE file for details.

---

**Built by [Zahid Aramai](https://zahidaramai.com)**
