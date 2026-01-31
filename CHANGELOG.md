# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.3.10] - 2026-01-23

### Added
- **Fetch Endpoint Full Invoice Data** - Both fetch endpoints now return complete invoice details:
  - `GET /api/v1/hashlhdn/invoices/:trackingId` - Returns `buyer` object and `links` for valid documents
  - `POST /api/v1/documents/fetch` - Returns `items` array and `buyer` object
  - Parsed from stored `rawPayload` and `buyerInfo` JSON fields
  - Links include share, verify, qr, view URLs for VALID documents

### Fixed
- **UI PDF Button** - Changed from API call to direct MyInvois portal link:
  - No longer calls `/pdf` endpoint which required MyInvois API access
  - Directly constructs `https://myinvois.hasil.gov.my/{uuid}/share/{longId}` URL
  - Opens MyInvois portal in new tab instantly
  - Works for all VALID documents with longId

### Verified
- **Cancel Functionality** - Tested and validated on LHDN MyInvois portal:
  - Cancel button successfully rejects invoices
  - Cancellation timestamp recorded on MyInvois portal
  - Status correctly updates to CANCELLED in both systems

---

## [1.3.9] - 2026-01-23

### Fixed
- **API Response Field Names** - Fixed field name mismatch between backend and frontend:
  - Changed `uuid` → `myinvoisUuid` in all document list and detail responses
  - Changed `longId` → `myinvoisLongId` in all document list and detail responses
  - Fixes action icons not showing in UI (QR, PDF, Links buttons)
  - Fixes PDF download "DOCUMENT_NOT_FOUND" error
  - Affected endpoints:
    - `GET /api/v1/documents` (list)
    - `POST /api/v1/documents/fetch` (legacy fetch)
    - `GET /api/v1/documents/:uuid/status` (status refresh)
    - `GET /api/v1/documents/:uuid/pdf` (PDF download)
    - `GET /api/v1/documents/:uuid/links` (links)
    - `POST /api/v1/documents/:uuid/cancel` (legacy cancel)

---

## [1.3.8] - 2026-01-23

### Added
- **QR Code Generation Endpoint** - `GET /api/v1/documents/:uuid/qr`:
  - Generates PNG QR code (300x300px) containing share link
  - Only available for VALID documents with longId
  - Returns proper Content-Type: image/png header

- **Document Links Endpoint** - `GET /api/v1/documents/:uuid/links`:
  - Returns all shareable URLs for a valid document
  - Includes: share, verify, qr, view links
  - Only available for VALID documents with longId

- **Document Response Links** - Document list and status endpoints now include `links` object:
  - `share`: Direct share link (`https://myinvois.hasil.gov.my/{uuid}/share/{longId}`)
  - `verify`: Verification link (`https://myinvois.hasil.gov.my/verify/{longId}`)
  - `qr`: Internal QR endpoint (`/api/v1/documents/{uuid}/qr`)
  - `view`: View link (same as share)

- **UI QR Code Modal** - New component for displaying and downloading QR codes:
  - Shows QR code with loading state
  - Copy share link to clipboard
  - Download QR as PNG file
  - Only shown for valid documents

- **UI Action Icons** - Invoice table actions column now includes:
  - View on MyInvois (external link icon)
  - Show QR Code (QR icon)
  - Copy Share Link (link icon)
  - Only visible for VALID documents with links

---

## [1.3.7] - 2026-01-23

### Fixed
- **AutoPoller INTERMEDIARY Mode** - Fixed status polling for ERP on-behalf mode:
  - Now uses `@myinvois/myinvois-client` properly with `SessionCredentials`
  - Correctly sends `onbehalfof` header during both login AND document details fetch
  - Session includes `mode: "INTERMEDIARY"` and `onBehalfOf: company.tin`
  - Fixed 404 errors when fetching document status in ERP mode

### Changed
- **B2C Invoice TIN Handling** - Fixed incorrect TIN fallback:
  - Previously used NRIC as TIN fallback which was wrong
  - TIN is now sent separately (individual TIN starts with "IG")
  - Added placeholder hint showing "Individual TIN (e.g., IG12345678901)" for B2C

---

## [1.3.5] - 2026-01-23

### Changed
- **Submit Draft Endpoint - Async Pattern** - POST /api/v1/documents/:trackingId/submit:
  - Now uses fire-and-forget pattern for MyInvois submission
  - Returns immediately with SUBMITTING status (HTTP 202)
  - Background process handles actual submission to MyInvois
  - Updates status to SUBMITTED (success) or INVALID (failure) asynchronously
  - Prevents timeout errors on slow MyInvois responses
  - Background poller updates status to VALID once longId is received

---

## [1.3.4] - 2026-01-23

### Added
- **PUT /api/v1/documents/:trackingId endpoint** - Update draft invoice data:
  - Updates invoice fields (date, amount, tax, items, buyer)
  - Only works for DRAFT status invoices
  - Properly updates rawPayload for subsequent submissions

### Changed
- **Edit Invoice Flow** - Changed from DELETE + CREATE to PUT:
  - More efficient and atomic update operation
  - Preserves invoice trackingId and invoiceNumber
  - No unique constraint violations on invoiceNumber

---

## [1.3.3] - 2026-01-23

### Added
- **Invoice Edit Feature** - Edit icon in invoice list actions for DRAFT invoices:
  - Opens pre-populated edit form with existing invoice data
  - Allows modification of all fields including line items
  - Saves changes by deleting old draft and creating new one via justsave
  - Form header and buttons update to show "Edit Invoice" / "Update Invoice" when editing

- **Expandable Line Items in Invoice Detail View** - Click on any item to expand and see details:
  - Shows Qty, Unit Price, Tax Rate, and Total
  - Accordion-style toggle with chevron rotation animation
  - Matches reference design from hashlhdn.com

---

## [1.3.2] - 2026-01-23

### Added
- **Invoice Detail View** - Eye icon action in invoice list to view invoice details:
  - Shows line items with description, tax code, and amount
  - Displays summary section (Subtotal, Tax, Discount, Rounding, Total)
  - Submit Invoice button for single draft invoice submission
  - Close button to return to invoice list

### Changed
- **GET `/api/v1/hashlhdn/invoices/:trackingId`** - Now includes parsed `items` array from stored `rawPayload` for displaying invoice line items in detail view

---

## [1.2.5] - 2026-01-22

### Fixed
- **Company Update Endpoint - Legacy Field Normalization** - `PUT /api/v1/companies/:id` now accepts client's original field names (matching POST endpoint behavior):
  - `address1` → `address`
  - `stateCode` → `state`
  - `telephone` → `phone`
  - `industry1` → `industryCode`
  - `industryCode1` → `industryName`
  - `companyName` → `name`
  - `brn` → `idValue`
  - `sst` → `sstRegistration`

### Verified
- Full endpoint audit confirmed all other endpoints are consistent:
  - Users: No legacy field normalization needed
  - Roles: No legacy field normalization needed
  - Documents Submit: Full normalization via `normalizer.ts`
  - Documents Cancel: Handles PascalCase/camelCase

---

## [1.2.4] - 2026-01-22

### Fixed
- **Critical: Company creation not saving fields** - Storage layer `createCompany` and `updateCompany` functions were missing 11 fields (address, city, state, postalCode, country, phone, email, industryCode, industryName, sstRegistration, ttxRegistration). Only core fields (name, tin, idValue, idType) were being persisted. This caused companies created via UI to have blank fields despite submitting complete data.

---

## [1.2.3] - 2026-01-22

### Fixed
- Complete endpoint audit - add all missing response fields:
  - Users: PUT endpoints now include `createdAt`
  - Roles: GET /all and PUT endpoints now include `createdAt`, `updatedAt`
  - Documents: List/status/refresh endpoints include all invoice fields (id, trackingId, invoiceType, amount, discount, rounding, taxAmount, errorCode, errorMessage, timestamps)

---

## [1.2.2] - 2026-01-22

### Fixed
- Companies: All CRUD endpoints now return complete response with 11 additional fields (address, city, state, postalCode, country, phone, email, industryCode, industryName, sstRegistration, ttxRegistration)

---

## [1.2.1] - 2026-01-22

### Added
- Production URL documentation (`https://d18hdb19anlge7.cloudfront.net/api/v1`)
- AWS EB deployment changelog in README
- Developer contact information and expertise section
- Comprehensive AWS EB CLI deployment guide (`documentation/AWS-EB-DEPLOYMENT-GUIDE.md`)

### Changed
- README.md completely rewritten as final client deliverable
- Updated Base URL section with environment table

---

## [1.2.0] - 2026-01-21

### Added
- **CORS Support** - Enable all origins with configurable methods and headers
- **Automatic Status Polling** - Background poller every 30 minutes for SUBMITTED invoices
- **S3 Certificate Loading** - Load P12 certificates from AWS S3 bucket
- AWS Elastic Beanstalk deployment configuration
- `.ebextensions` for Node.js 22, Prisma migrations, environment setup
- `Procfile` for EB web server configuration
- Deployment scripts (`scripts/deploy-eb.sh`)

### Changed
- Default signing version now v1.1
- Production environment uses RDS PostgreSQL and ElastiCache Redis

### Fixed
- EB deployment issues for Node.js 22 platform
- OpenTelemetry instrumentation compatibility
- Prisma client generation in bundled deployment

---

## [1.1.1] - 2026-01-20

### Added
- **Legacy Document Routes** for client Postman collection compatibility:
  - `POST /api/v1/documents/cancel` - Cancel via MyInvois UUID
  - `POST /api/v1/documents/fetch` - Fetch status via MyInvois UUID
  - `GET /api/v1/documents` with client param aliases (CompanyId, StartDate, EndDate)
- **Submit Draft Endpoint** - `POST /api/v1/documents/:trackingId/submit`
- Company creation endpoint alias `POST /api/v1/companies/create`
- Buyer email support in invoice submissions
- Invoice polling for status updates

### Changed
- Field mappings improved for cancel, fetch, and company endpoints
- Client compatibility enhancements for Postman collection

### Fixed
- v1.0 submission format issues
- BRN=NA for consolidated invoice buyer
- Lexical declaration errors in switch cases

---

## [1.1.0] - 2026-01-19

### Fixed
- **Digital Signature Format** - Correct v1.1 signature structure for MyInvois validation:
  - SignatureValue format: `[{ _: signatureBase64 }]` per UBL JSON spec
  - QualifyingProperties instead of XadesQualifyingProperties
  - UBLExtensions and Signature placed at END of document
  - Signature reference block for MyInvois requirements
- Resolves MyInvois validation errors DS300, DS301

---

## [0.3.0] - 2026-01-19

### Added
- **HashLHDN Adapter Layer** (`apps/gateway/src/adapters/hashlhdn/`)
  - Request normalizer for client's original format
  - UBL 2.1 transformer for MyInvois submission
  - Support for PascalCase and mixed-case field names
- **4 Submission Endpoints**:
  - `POST /api/v1/hashlhdn/submit-consolidate` - B2C daily sales
  - `POST /api/v1/hashlhdn/submit-justsave` - Save without LHDN submission
  - `POST /api/v1/hashlhdn/submit-buyer` - B2B with buyer TIN + BRN
  - `POST /api/v1/hashlhdn/submit-personal` - B2C with buyer NRIC
- **Legacy Unified Endpoint** - `POST /api/v1/documents/submit` with flags
- **Management APIs**:
  - Users CRUD (`/api/v1/users`)
  - Roles CRUD (`/api/v1/roles`)
  - Companies CRUD (`/api/v1/companies`)
  - Company credentials (`PUT /api/v1/companies/:id/credentials`)
- **JWT Authentication**:
  - Login with access + refresh tokens
  - Token refresh endpoint
  - Role-based permissions
- **Document Operations**:
  - List with filters (`GET /api/v1/documents`)
  - Status check (`GET /api/v1/documents/:uuid/status`)
  - PDF download (`GET /api/v1/documents/:uuid/pdf`)
  - Cancel (`POST /api/v1/documents/:uuid/cancel`)
- Prisma schema extensions for User, Role, Company, UserCompany
- Postman collection and environment files

### Changed
- README simplified for HashLHDN private repository
- OpenAPI folder renamed to documentation
- Tech stack badges added to README

---

## [0.2.1] - 2026-01-19

### Added
- **PKCS#12 Support** - Native P12 certificate loading using node-forge
  - `loadPKCS12`, `loadPKCS12FromFile`, `loadPKCS12FromBase64` functions
  - Environment variables: `SIGNING_PKCS12_PATH`, `SIGNING_PKCS12_BASE64`, `SIGNING_PKCS12_PASSPHRASE`
- `onbehalfof` header support for INTERMEDIARY mode
- Debug and test scripts for v1.1 signing

### Fixed
- MyInvois JSON signing structure preservation
- Namespace prefixes (_D, _A, _B) maintained
- Array-wrapped documents handled correctly

---

## [0.2.0] - 2026-01-18

### Added
- **@myinvois/signing Package** - X.509 digital signature support:
  - Certificate loading from file, base64, or environment variables
  - RSA-SHA256 digital signatures
  - Certificate validation (expiry, not-yet-valid, key matching)
  - Document hash generation using SHA-256
  - Signature injection into UBL Extensions
  - Signature verification for received documents
  - Performance: <2ms per document
- **Gateway Signing Integration**:
  - Session creation supports `documentVersion` parameter (1.0 or 1.1)
  - Automatic document signing for v1.1 sessions
  - Health endpoint reports signing status and certificate expiry
- **Signing Configuration**:
  - `SIGNING_ENABLED` - Enable/disable document signing
  - `SIGNING_DEFAULT_VERSION` - Default document version
  - `SIGNING_CERT_PATH` / `SIGNING_CERT_BASE64` - Certificate loading
  - `SIGNING_KEY_PATH` / `SIGNING_KEY_BASE64` - Private key loading
  - `SIGNING_KEY_PASSPHRASE` - Encrypted private key support
- **Signing Error Codes**:
  - `CERTIFICATE_LOAD_FAILED`, `PRIVATE_KEY_LOAD_FAILED`
  - `CERTIFICATE_EXPIRED`, `CERTIFICATE_NOT_YET_VALID`
  - `KEY_CERTIFICATE_MISMATCH`, `SIGNING_FAILED`
  - `SIGNATURE_VERIFICATION_FAILED`, `SIGNING_NOT_CONFIGURED`
- Comprehensive v1.1 signing negative tests (19 tests)
- MSW handlers for signature validation errors
- Deployment guides (monolith, Kubernetes, Docker)
- Frontend integration examples (React, NestJS, PHP, Python)

### Changed
- OpenAPI specification updated with DocumentVersion schema
- Core package updated with signing error codes

---

## [0.1.1] - 2026-01-17

### Added
- **Comprehensive Negative Test Suite** - 20+ error scenarios
- **ErrorEnvelope Type** - Unified error response format
- **Error Normalizer** - Maps MyInvois validation steps to stable codes
- **Error Codes**:
  - Business: `DUPLICATE_SUBMISSION`, `INVALID_TAXPAYER`, `INVALID_TOTALS`
  - Infrastructure: `UPSTREAM_TIMEOUT`, `UPSTREAM_ERROR`, `UPSTREAM_RATE_LIMITED`
  - Auth: `AUTH_INVALID_CLIENT`, `AUTH_TOKEN_EXPIRED`, `AUTH_UNAVAILABLE`
  - Local: `PAYLOAD_TOO_LARGE`, `VALIDATION_ERROR`, `IDEMPOTENCY_CONFLICT`
- MSW negative handlers for testing
- Documentation: `docs/testing.md`, `docs/troubleshooting.md`

### Fixed
- Real MyInvois validationSteps response structure parsing
- innerError array extraction for user-facing messages
- Test assertions aligned with ErrorEnvelope format

---

## [0.1.0] - 2026-01-15

### Added
- **Initial Release** - MyInvois Middleware Gateway
- **OAuth2 Token Caching** - Automatic refresh before expiry
- **Rate Limiting** - Per MyInvois endpoint enforcement:
  - Login: 12 RPM
  - Submit: 100 RPM
  - Poll: 300 RPM
- **Document Submission** - Batching support:
  - Max 100 documents per submission
  - Max 5MB total size
  - Max 300KB per document
- **Background Polling Worker** - BullMQ-based status updates
- **Duplicate Detection** - 10-minute window
- **Error Normalization** - Correlation IDs for tracking
- **Health Check Endpoints** - `/healthz`, `/readyz`
- **Prometheus Metrics** - `/metrics` endpoint
- **OpenAPI 3.0 Specification** - API contract
- **Document APIs**:
  - `getDocument`, `searchDocuments`, `getRecentDocuments`
  - `documentTypes` for MyInvois codes
- **UBL Invoice Builder** - Party and line item helpers
- **MyInvois Classification Codes** - Tax codes, state codes

### Infrastructure
- Fastify 5.x with TypeScript
- PostgreSQL with Prisma ORM
- Redis for rate limiting and queues
- pnpm monorepo structure

---

## Package Versions

| Release | @myinvois/gateway | @myinvois/signing | @myinvois/core | @myinvois/client |
|---------|-------------------|-------------------|----------------|------------------|
| 1.2.1   | 1.2.1             | 0.2.1             | 0.1.3          | 0.2.2            |
| 1.2.0   | 1.2.0             | 0.2.1             | 0.1.3          | 0.2.2            |
| 1.1.1   | 1.1.1             | 0.2.1             | 0.1.3          | 0.2.2            |
| 1.1.0   | 1.1.0             | 0.2.1             | 0.1.3          | 0.2.2            |
| 0.3.0   | 0.3.0             | 0.2.0             | 0.1.2          | 0.2.1            |
| 0.2.1   | 0.2.1             | 0.2.0             | 0.1.2          | 0.2.1            |
| 0.2.0   | 0.2.0             | 0.1.0             | 0.1.1          | 0.2.0            |
| 0.1.0   | 0.1.0             | -                 | 0.1.0          | 0.1.0            |

---

[1.3.10]: https://github.com/shmoulana/duitlhdn/releases/tag/v1.3.10
[1.2.1]: https://github.com/shmoulana/duitlhdn/releases/tag/v1.2.1
[1.2.0]: https://github.com/shmoulana/duitlhdn/releases/tag/v1.2.0
[1.1.1]: https://github.com/shmoulana/duitlhdn/releases/tag/v1.1.1
[1.1.0]: https://github.com/shmoulana/duitlhdn/releases/tag/v1.1.0
[0.3.0]: https://github.com/shmoulana/duitlhdn/releases/tag/v0.3.0
[0.2.1]: https://github.com/shmoulana/duitlhdn/releases/tag/v0.2.1
[0.2.0]: https://github.com/shmoulana/duitlhdn/compare/v0.1.0...v0.2.0
[0.1.1]: https://github.com/shmoulana/duitlhdn/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/shmoulana/duitlhdn/releases/tag/v0.1.0
