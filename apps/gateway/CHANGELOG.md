# @myinvois/gateway

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
