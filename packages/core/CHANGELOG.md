# @myinvois/core

## 0.1.4

### Patch Changes

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

## 0.1.3

### Patch Changes

- 03d35bd: fix: Correct digital signature format for MyInvois v1.1 compliance
  - SignatureValue format changed to `[{ _: signatureBase64 }]` per UBL JSON specification
  - QualifyingProperties used instead of XadesQualifyingProperties
  - UBLExtensions and Signature elements placed at END of document content
  - Signature reference block added to satisfy MyInvois v1.1 requirements
  - Both UBLExtensions and Signature now properly excluded from document hash

  This resolves MyInvois validation errors DS300 and DS301.

## 0.1.2

### Patch Changes

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

## 0.1.1

### Patch Changes

- 0b530f4: feat(errors): Add comprehensive error normalization for MyInvois validation responses
  - Add unified ErrorEnvelope type for consistent error responses
  - Parse real MyInvois validationSteps structure with innerError arrays
  - Map validation step names (Step03-Step07) to stable error codes
  - Add MSW handlers for negative test scenarios
  - Add 35 error normalizer tests covering all error cases
  - Document error codes, retry strategies, and troubleshooting guide
