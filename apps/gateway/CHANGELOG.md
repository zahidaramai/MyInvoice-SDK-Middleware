# @myinvois/gateway

## 0.3.2

### Patch Changes

- feat(scripts): add comprehensive document issuing script

  Add issue-document.ts script supporting all 9 MyInvois document types:
  - Invoice (01) and Consolidated Invoice
  - Credit Note (02), Debit Note (03), Refund Note (04)
  - Self-billed Invoice (11), Credit (12), Debit (13), Refund (14) Notes

  Features:
  - Support for both v1.0 (unsigned) and v1.1 (signed) documents
  - Automatic BillingReference for adjustment documents
  - CLI options for all document parameters

## 0.3.1

### Patch Changes

- Updated dependencies
  - @myinvois/signing@0.2.2

## 0.3.0

### Minor Changes

- Simplify codebase for open source release

  **@myinvois/gateway**
  - Remove deprecated GatewayError and LegacyErrorEnvelope interfaces
  - Extract shared validation utilities to lib/validation.ts
  - Consolidate duplicate cancel/reject handlers in documents route
  - Remove unused error creator functions

  **@myinvois/myinvois-client**
  - Extract error patterns to separate error-patterns.ts module
  - Simplify error-normalizer.ts by removing inline patterns

  **@myinvois/core**
  - Remove unused MyInvoisValidationSteps constant

  **Security**
  - Remove scripts with hardcoded credentials
  - Sanitize test data files

### Patch Changes

- Updated dependencies
  - @myinvois/myinvois-client@0.2.3
  - @myinvois/core@0.1.4

## 0.2.1

### Patch Changes

- Updated dependencies [03d35bd]
  - @myinvois/signing@0.2.1
  - @myinvois/core@0.1.3
  - @myinvois/myinvois-client@0.2.2

## 0.2.0

### Minor Changes

- 81913d7: Add MyInvois v1.1 document signing support

  ## New Package: @myinvois/signing
  - X.509 certificate loading from file, base64, or environment variables
  - RSA-SHA256 digital signatures for MyInvois v1.1 documents
  - Certificate validation (expiry, not-yet-valid, key matching)
  - Document hash generation using SHA-256
  - Signature injection into UBL Extensions structure
  - Performance: <2ms per document signing operation

  ## Gateway Integration
  - Session creation now supports `documentVersion` parameter (`1.0` or `1.1`)
  - Automatic document signing for v1.1 sessions
  - Health endpoint reports signing status and certificate expiry
  - New signing-related error codes with detailed context

  ## Configuration

  New environment variables:
  - `SIGNING_ENABLED` - Enable/disable document signing
  - `SIGNING_DEFAULT_VERSION` - Default document version
  - `SIGNING_CERT_PATH` / `SIGNING_CERT_BASE64` - Certificate loading
  - `SIGNING_KEY_PATH` / `SIGNING_KEY_BASE64` - Private key loading

  ## Documentation
  - Added signing guide (`docs/signing.md`)
  - Added migration guide (`docs/migration-v1.0-to-v1.1.md`)
  - Updated README with signing configuration

### Patch Changes

- Updated dependencies [81913d7]
  - @myinvois/signing@0.2.0
  - @myinvois/core@0.1.2
  - @myinvois/myinvois-client@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [0b530f4]
  - @myinvois/myinvois-client@0.2.0
  - @myinvois/core@0.1.1
