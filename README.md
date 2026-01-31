# HashLHDN MyInvois Middleware

[![CI](https://github.com/shmoulana/duitlhdn/actions/workflows/ci.yml/badge.svg)](https://github.com/shmoulana/duitlhdn/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/shmoulana/duitlhdn)](https://github.com/shmoulana/duitlhdn/releases)

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma&logoColor=white)

Enterprise-grade API middleware gateway for Malaysia's MyInvois e-invoicing system (LHDN).

**Client:** Hashmato | **Version:** 1.3.10 | **Production Ready**

> **Production API:** `https://d18hdb19anlge7.cloudfront.net/api/v1`

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## Features

| Feature | Description | Status |
|---------|-------------|--------|
| **4 Submission Endpoints** | Consolidated, JustSave, B2B, B2C | ✅ Done |
| **JWT Authentication** | Access + Refresh tokens, role-based | ✅ Done |
| **User Management** | Users, Roles, Companies CRUD | ✅ Done |
| **Document Operations** | List, Status, PDF, Cancel | ✅ Done |
| **Digital Signing v1.1** | X.509 certificate signing (LHDN spec) | ✅ Done |
| **Auto Status Polling** | Background polling every 30 minutes | ✅ Done |
| **CORS Support** | All origins enabled | ✅ Done |
| **Rate Limiting** | Built-in LHDN rate limit enforcement | ✅ Done |
| **S3 Certificate Loading** | Load P12 from AWS S3 | ✅ Done |
| **Prometheus Metrics** | `/metrics` endpoint | ✅ Done |

---

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for local PostgreSQL/Redis)

### 1. Clone & Install

```bash
git clone https://github.com/shmoulana/duitlhdn.git
cd duitlhdn
pnpm install
```

### 2. Start Infrastructure

```bash
docker compose -f docker/docker-compose.yml up -d
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings
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
  -d '{"email":"admin@hashlhdn.com","password":"admin123"}'
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│                 │     │    HashLHDN Gateway      │     │                 │
│  Your Dashboard │────▶│  ┌──────────────────┐   │────▶│  MyInvois API   │
│  (React/Vue)    │     │  │ JWT Auth         │   │     │  (LHDN)         │
│                 │     │  │ CORS             │   │     │                 │
└─────────────────┘     │  │ Rate Limiting    │   │     └─────────────────┘
                        │  │ Digital Signing  │   │
                        │  │ JSON → UBL 2.1   │   │
                        │  └──────────────────┘   │
                        └────────────┬────────────┘
                                     │
                        ┌────────────▼────────────┐
                        │    Auto Status Poller   │
                        │    (Every 30 minutes)   │
                        └────────────┬────────────┘
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
   ┌──────▼──────┐           ┌───────▼───────┐          ┌──────▼──────┐
   │  PostgreSQL │           │    Redis      │          │  Prometheus │
   │  (Prisma)   │           │  (Rate Limit) │          │  (Metrics)  │
   └─────────────┘           └───────────────┘          └─────────────┘
```

---

## API Reference

### Base URL

| Environment | URL |
|-------------|-----|
| **Production** | `https://d18hdb19anlge7.cloudfront.net/api/v1` |
| **Local** | `http://localhost:3000/api/v1` |

All API endpoints below are relative to the base URL.

### Authentication

All endpoints except `/auth/login` require JWT token:

```
Authorization: Bearer <access_token>
```

---

### Auth Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/login` | Login, returns access + refresh tokens |
| POST | `/api/v1/auth/logout` | Invalidate tokens |
| POST | `/api/v1/auth/refresh` | Get new access token |
| GET | `/api/v1/auth/me` | Get current user info |

#### Login Request

```json
POST /api/v1/auth/login
{
  "email": "admin@hashlhdn.com",
  "password": "admin123"
}
```

#### Login Response

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900,
  "user": {
    "id": "abc123",
    "email": "admin@hashlhdn.com",
    "name": "Admin",
    "role": "Admin"
  }
}
```

---

### Submission Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/hashlhdn/submit-consolidate` | Consolidated invoice (B2C daily sales) |
| POST | `/api/v1/hashlhdn/submit-justsave` | Save without LHDN submission |
| POST | `/api/v1/hashlhdn/submit-buyer` | B2B invoice (with buyer TIN + BRN) |
| POST | `/api/v1/hashlhdn/submit-personal` | B2C invoice (with buyer NRIC) |

#### Legacy Unified Endpoint

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/documents/submit` | Unified submission with flags |

**Request Flags:**
- `ConsolidatedInvoice: true` → Consolidate endpoint
- `SaveInvoice: true` → JustSave endpoint
- `customer.IdType: "BRN"` → B2B endpoint
- `customer.IdType: "NRIC"` → B2C endpoint

---

### Submission Request Format

```json
POST /api/v1/hashlhdn/submit-buyer
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

### Submission Response

```json
{
  "success": true,
  "data": {
    "submissionId": "HJSD135P2S7D8IU",
    "documents": [{
      "uuid": "F9D425P6DS7D8IU",
      "invoiceNumber": "INV-2026-001",
      "status": "SUBMITTED",
      "trackingId": "local-tracking-id"
    }]
  }
}
```

---

### Document Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/documents` | List documents with filters |
| GET | `/api/v1/documents/:uuid/status` | Get document status |
| GET | `/api/v1/documents/:uuid/pdf` | Download PDF |
| POST | `/api/v1/documents/:uuid/cancel` | Cancel document |
| POST | `/api/v1/documents/:trackingId/submit` | Submit saved draft |

#### List Documents

```
GET /api/v1/documents?companyId=xxx&status=VALID&page=1&limit=20
```

#### Document Status Response

```json
{
  "uuid": "F9D425P6DS7D8IU",
  "status": "VALID",
  "longId": "ABC123XYZ789...",
  "invoiceNumber": "INV-2026-001",
  "validatedAt": "2026-01-21T10:05:00Z"
}
```

---

### Management Endpoints

#### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/users` | List all users |
| POST | `/api/v1/users` | Create user |
| GET | `/api/v1/users/:id` | Get user by ID |
| PUT | `/api/v1/users/:id` | Update user |
| DELETE | `/api/v1/users/:id` | Delete user |

#### Roles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/roles` | List all roles |
| POST | `/api/v1/roles` | Create role |
| GET | `/api/v1/roles/:id` | Get role by ID |
| PUT | `/api/v1/roles/:id` | Update role |
| DELETE | `/api/v1/roles/:id` | Delete role |

#### Companies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/companies` | List companies |
| POST | `/api/v1/companies` | Create company |
| GET | `/api/v1/companies/:id` | Get company |
| PUT | `/api/v1/companies/:id` | Update company |
| DELETE | `/api/v1/companies/:id` | Delete company |
| PUT | `/api/v1/companies/:id/credentials` | Set MyInvois credentials |

#### User-Company Mapping

Link users to companies for access control. A user can be linked to multiple companies.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/companies/all` | Get all companies (for dropdown) |
| POST | `/api/v1/users/:userId/companies/:companyId` | Link user to company |
| DELETE | `/api/v1/users/:userId/companies/:companyId` | Unlink user from company |
| GET | `/api/v1/users/:userId` | Get user with linked companies |

**Alternative endpoints (from company side):**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/companies/:companyId/users/:userId` | Link user to company |
| DELETE | `/api/v1/companies/:companyId/users/:userId` | Unlink user from company |

##### UI Workflow: Map User to Company

**Step 1: Get companies for dropdown**

```
GET /api/v1/companies/all
```

Response:
```json
{
  "data": [
    {
      "id": "5ac34ecc-dcc0-4e9c-beaf-ea468fe6c05d",
      "name": "B POINT STATION SDN. BHD",
      "tin": "C24558460090",
      "idValue": "202401000123"
    }
  ]
}
```

**Step 2: Link selected company to user**

```
POST /api/v1/users/{userId}/companies/{companyId}
```

Response:
```json
{
  "message": "User linked to company successfully"
}
```

**Step 3: View user's linked companies**

```
GET /api/v1/users/{userId}
```

Response:
```json
{
  "id": "ab404e1a-808d-4324-8f1d-49957f388ff6",
  "email": "admin@hashlhdn.com",
  "name": "Admin User",
  "role": {
    "id": "role-id",
    "name": "Admin"
  },
  "companies": [
    {
      "id": "5ac34ecc-dcc0-4e9c-beaf-ea468fe6c05d",
      "name": "B POINT STATION SDN. BHD",
      "tin": "C24558460090"
    }
  ],
  "isActive": true,
  "createdAt": "2026-01-20T12:00:00.000Z",
  "updatedAt": "2026-01-22T10:00:00.000Z"
}
```

**Step 4: Remove link (if needed)**

```
DELETE /api/v1/users/{userId}/companies/{companyId}
```

Response: `204 No Content`

---

### Health & Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Basic health check |
| GET | `/healthz` | Kubernetes health probe |
| GET | `/readyz` | Readiness probe (DB/Redis) |
| GET | `/metrics` | Prometheus metrics |
| GET | `/version` | Version info |

---

## Deployment

### Option 1: AWS Elastic Beanstalk (Recommended)

**Full Guide:** [documentation/AWS-EB-DEPLOYMENT-GUIDE.md](documentation/AWS-EB-DEPLOYMENT-GUIDE.md)

```bash
# 1. Build deployment package
./scripts/deploy-eb.sh v1.2.0

# 2. Upload to S3
aws s3 cp .deploy/hashlhdn-v1.2.0.zip \
  s3://your-bucket/hashlhdn-middleware/v1.2.0.zip

# 3. Create application version
aws elasticbeanstalk create-application-version \
  --application-name hashlhdn-middleware \
  --version-label "v1.2.0" \
  --source-bundle S3Bucket=your-bucket,S3Key=hashlhdn-middleware/v1.2.0.zip

# 4. Deploy
aws elasticbeanstalk update-environment \
  --environment-name hashlhdn-prod \
  --version-label "v1.2.0"
```

### Option 2: Docker Compose

**Full Guide:** [documentation/DEPLOYMENT.md](documentation/DEPLOYMENT.md)

```bash
# 1. Copy environment template
cp .env.production.template .env

# 2. Edit configuration
nano .env

# 3. Deploy
docker compose -f docker/docker-compose.prod.yml up -d

# 4. Run migrations
docker compose exec gateway npx prisma migrate deploy
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `REDIS_URL` | ✅ | - | Redis connection string |
| `JWT_SECRET` | ✅ | - | Access token signing key (64 hex chars) |
| `JWT_REFRESH_SECRET` | ✅ | - | Refresh token signing key (64 hex chars) |
| `NODE_ENV` | ❌ | development | Environment (production/development) |
| `PORT` | ❌ | 3000 | Server port |
| `LOG_LEVEL` | ❌ | debug | Logging level (debug/info/warn/error) |
| `JWT_ACCESS_EXPIRY` | ❌ | 15m | Access token expiry |
| `JWT_REFRESH_EXPIRY` | ❌ | 7d | Refresh token expiry |
| `SIGNING_ENABLED` | ❌ | true | Enable document signing |
| `SIGNING_DEFAULT_VERSION` | ❌ | 1.1 | Default document version |
| `SIGNING_PKCS12_PATH` | ❌ | - | Path to P12 certificate (local or S3) |
| `SIGNING_PKCS12_PASSPHRASE` | ❌ | - | P12 certificate passphrase |
| `MYINVOIS_ENV` | ❌ | SANDBOX | MyInvois environment (SANDBOX/PROD) |
| `METRICS_ENABLED` | ❌ | true | Enable Prometheus metrics |

### Generate Secure Secrets

```bash
# JWT secrets (64 hex characters)
openssl rand -hex 32

# Example output: a1b2c3d4e5f6789...
```

---

## Digital Signing (v1.1)

Documents submitted with `documentVersion: "1.1"` are automatically signed using X.509 certificates per LHDN specification.

### Certificate Setup

**Option 1: Local File**
```env
SIGNING_PKCS12_PATH=/path/to/certificate.p12
SIGNING_PKCS12_PASSPHRASE=your-password
```

**Option 2: AWS S3**
```env
SIGNING_PKCS12_PATH=s3://your-bucket/certificates/signing.p12
SIGNING_PKCS12_PASSPHRASE=your-password
```

### Signing Process

1. Gateway receives document
2. Calculates document hash (SHA-256)
3. Signs hash with private key from P12 certificate
4. Adds signature to UBL document
5. Submits signed document to MyInvois

---

## Permissions & Roles

Role-based access control with **6 permissions**. These are the **only valid permission values** - do not create custom permissions.

### Available Permissions

| Permission | Description | Endpoints Covered |
|------------|-------------|-------------------|
| `submit:invoice` | Submit invoices to LHDN | `/hashlhdn/*`, `/documents/submit` |
| `read:documents` | View documents and statuses | `/documents`, `/documents/:uuid/status` |
| `cancel:documents` | Cancel submitted documents | `/documents/:uuid/cancel` |
| `manage:users` | Create, edit, delete, view users | `/users/*` |
| `manage:roles` | Create, edit, delete, view roles | `/roles/*` |
| `manage:companies` | Create, edit, delete, view companies | `/companies/*` |

### Get Permissions from API

```
GET /api/v1/roles/permissions
```

Response:
```json
{
  "permissions": [
    "submit:invoice",
    "read:documents",
    "cancel:documents",
    "manage:users",
    "manage:roles",
    "manage:companies"
  ]
}
```

**Important for UI developers:** Use this endpoint to populate permission dropdowns. Only these 6 values are valid.

### Default Roles (Pre-seeded)

| Role | Description | Permissions |
|------|-------------|-------------|
| **Admin** | Full system administrator | All 6 permissions |
| **Invoice Manager** | Staff handling invoice operations | `submit:invoice`, `read:documents`, `cancel:documents` |
| **Viewer** | Read-only access | `read:documents` |

### Permission Matrix

| Role | submit:invoice | read:documents | cancel:documents | manage:users | manage:roles | manage:companies |
|------|:--------------:|:--------------:|:----------------:|:------------:|:------------:|:----------------:|
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Invoice Manager | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Viewer | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Creating Custom Roles

You can create additional roles via API, but **must use only the 6 available permissions**.

```
POST /api/v1/roles
```

Request:
```json
{
  "name": "Accountant",
  "description": "Can submit and view invoices",
  "permissions": ["submit:invoice", "read:documents"]
}
```

Response:
```json
{
  "id": "role-uuid",
  "name": "Accountant",
  "description": "Can submit and view invoices",
  "permissions": ["submit:invoice", "read:documents"],
  "createdAt": "2026-01-22T10:00:00.000Z"
}
```

### Roles Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/roles` | List all roles (paginated) |
| GET | `/api/v1/roles/all` | Get all roles (for dropdown) |
| GET | `/api/v1/roles/permissions` | Get available permissions |
| POST | `/api/v1/roles` | Create role |
| GET | `/api/v1/roles/:id` | Get role by ID |
| PUT | `/api/v1/roles/:id` | Update role |
| DELETE | `/api/v1/roles/:id` | Delete role |

### Assign Role to User

```
PUT /api/v1/users/:id/role
```

Request:
```json
{
  "roleId": "role-uuid"
}
```

---

## Project Structure

```
duitlhdn/
├── apps/
│   ├── gateway/                 # REST API (Fastify)
│   │   ├── src/
│   │   │   ├── adapters/hashlhdn/   # Submission endpoints
│   │   │   ├── auth/                # JWT authentication
│   │   │   ├── management/          # User/Role/Company CRUD
│   │   │   ├── polling/             # Auto status poller
│   │   │   ├── config/              # S3 loader, signing config
│   │   │   └── routes/              # Core routes
│   │   ├── .ebextensions/           # EB configuration
│   │   └── Procfile                 # EB process file
│   └── worker/                  # Background job processor
├── packages/
│   ├── contracts/               # Shared TypeScript types
│   ├── core/                    # Rate limiter, utilities
│   ├── myinvois-client/         # MyInvois API client
│   ├── signing/                 # X.509 signing (v1.1)
│   └── storage/                 # Prisma + PostgreSQL
│       └── prisma/
│           ├── schema.prisma    # Database schema
│           └── seed.ts          # Database seeder
├── docker/
│   ├── docker-compose.yml       # Development
│   └── docker-compose.prod.yml  # Production
├── scripts/
│   ├── deploy-eb.sh             # EB deployment builder
│   └── deploy.sh                # Docker deployment
├── documentation/
│   ├── openapi.yaml             # OpenAPI 3.0 spec
│   ├── AWS-EB-DEPLOYMENT-GUIDE.md
│   ├── DEPLOYMENT.md
│   └── HashLHDN-API-*.postman_collection.json
└── .github/workflows/           # CI/CD pipelines
```

---

## Commands

### Development

```bash
# Install dependencies
pnpm install

# Start dev server (hot reload)
pnpm --filter @myinvois/gateway dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linting + type check + tests + build
pnpm check
```

### Database

```bash
# Run migrations
pnpm --filter @myinvois/storage prisma migrate dev

# Generate Prisma client
pnpm --filter @myinvois/storage prisma generate

# Seed database
pnpm --filter @myinvois/storage prisma db seed

# Open Prisma Studio
pnpm --filter @myinvois/storage prisma studio
```

### Deployment

```bash
# Build EB deployment package
./scripts/deploy-eb.sh v1.2.0

# Docker Compose deployment
./scripts/deploy.sh deploy
```

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

---

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

1. **Use strong JWT secrets** (64+ hex characters)
2. **Enable HTTPS** in production (via CloudFront or ALB)
3. **Restrict security groups** to minimum required
4. **Enable RDS encryption** at rest
5. **Rotate secrets** annually
6. **Monitor CloudWatch** for anomalies

### CORS Configuration

Currently configured to allow all origins:

```typescript
cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
})
```

To restrict to specific domains, modify `apps/gateway/src/app.ts`.

---

## Troubleshooting

### Common Issues

#### 401 Unauthorized

- Token expired → Use `/auth/refresh` to get new token
- Invalid token → Re-login via `/auth/login`

#### 403 Forbidden

- Missing permissions → Check user role permissions
- Wrong company → User not linked to company

#### 502 Bad Gateway (EB)

- App failed to start → Check CloudWatch logs
- Missing env vars → Verify EB configuration
- Database connection → Check security groups

#### Certificate Errors

- File not found → Verify `SIGNING_PKCS12_PATH`
- Invalid password → Check `SIGNING_PKCS12_PASSPHRASE`
- S3 access denied → Check IAM permissions

### Debug Commands

```bash
# Local logs
pnpm --filter @myinvois/gateway dev 2>&1 | tee app.log

# EB logs
eb logs hashlhdn-prod

# Docker logs
docker compose logs -f gateway

# Test health
curl http://localhost:3000/health
```

---

## API Documentation

### Postman Collection

Import `documentation/HashLHDN-API-v1.1.2.postman_collection.json` into Postman:

1. Open Postman
2. Click **Import**
3. Upload the collection file
4. Set `baseUrl` variable to your API URL

### OpenAPI Specification

Available at `documentation/openapi.yaml`

Import into:
- Swagger UI
- Stoplight Studio
- Postman
- Any OpenAPI-compatible tool

---

## Release History

| Version | Date | Changes |
|---------|------|---------|
| v1.2.1 | 2026-01-22 | Final deliverable with production URL documentation |
| v1.2.0 | 2026-01-21 | CORS support, auto-polling, S3 certificates, production deploy |
| v1.1.1 | 2026-01-20 | Fixed v1.1 signature format per LHDN spec |
| v1.1.0 | 2026-01-19 | Added v1.1 digital signing |
| v1.0.0 | 2026-01-18 | Initial HashLHDN implementation |

---

## AWS EB Deployment Changelog

**Current Production:** `v1.0.28-cors` | **Platform:** Node.js 22 on Amazon Linux 2023

| EB Version | Date | Description |
|------------|------|-------------|
| v1.0.28-cors | 2026-01-21 | CORS support for all origins |
| v1-0-27-autopoller | 2026-01-21 | Auto status polling every 30 minutes |
| hashlhdn-v1-0-25 | 2026-01-21 | S3 certificate loading, PROD environment |
| hashlhdn-v1-0-24b | 2026-01-21 | OpenTelemetry fixes for EB |
| v1-0-23 | 2026-01-21 | Prisma client generation fix |
| v1-0-22 | 2026-01-20 | Database migrations, seeding disabled |
| v1-0-15 | 2026-01-20 | Initial EB deployment with Node.js 22 |

---

## Support

- **GitHub Issues:** https://github.com/shmoulana/duitlhdn/issues
- **Documentation:** `/documentation` folder
- **API Reference:** Postman collection

---

## Developer

**Zahid Aramai** - Full-Stack Developer & System Architect

Specialized in enterprise API development, e-invoicing integrations, and cloud infrastructure. Expert in Node.js, TypeScript, PostgreSQL, Redis, and AWS services.

| Contact | |
|---------|---|
| **Email** | hello@zahidaramai.com |
| **Phone** | +601151978879 |
| **Website** | [zahidaramai.com](https://zahidaramai.com) |

**Expertise:**
- MyInvois / LHDN e-Invoicing Integration
- Enterprise API Gateway Development
- Digital Signing & Cryptography (X.509, PKCS#12)
- AWS Infrastructure (EB, RDS, ElastiCache, S3, CloudFront)
- High-performance Node.js Applications

---

## License

Proprietary - Hashmato / KLCUBE NETWORK Enterprise

This software is developed exclusively for Hashmato under proposal PROP-HASH-001. Unauthorized use, reproduction, or distribution is prohibited.

---

**KLCUBE NETWORK Enterprise** | Developed by [Zahid Aramai](https://zahidaramai.com) for Hashmato
