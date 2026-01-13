# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Document Signing (MyInvois v1.1 Support)

- **New Package: `@myinvois/signing`**
  - X.509 certificate loading from file, base64, or environment variables
  - RSA-SHA256 digital signatures for MyInvois v1.1 documents
  - Certificate validation (expiry, not-yet-valid, key matching)
  - Document hash generation using SHA-256
  - Signature injection into UBL Extensions structure
  - Signature verification for received documents
  - Performance: <2ms per document signing operation

- **Gateway Integration**
  - Session creation now supports `documentVersion` parameter (`1.0` or `1.1`)
  - Automatic document signing for v1.1 sessions
  - Health endpoint (`/readyz`) reports signing status and certificate expiry
  - New signing-related error codes with detailed context

- **Configuration Options**
  - `SIGNING_ENABLED` - Enable/disable document signing
  - `SIGNING_DEFAULT_VERSION` - Default document version (1.0 or 1.1)
  - `SIGNING_CERT_PATH` / `SIGNING_CERT_BASE64` - Certificate loading
  - `SIGNING_KEY_PATH` / `SIGNING_KEY_BASE64` - Private key loading
  - `SIGNING_KEY_PASSPHRASE` - Support for encrypted private keys

- **Error Handling**
  - `CERTIFICATE_LOAD_FAILED` - Failed to load signing certificate
  - `PRIVATE_KEY_LOAD_FAILED` - Failed to load private key
  - `CERTIFICATE_EXPIRED` - Certificate has expired
  - `CERTIFICATE_NOT_YET_VALID` - Certificate is not yet valid
  - `KEY_CERTIFICATE_MISMATCH` - Private key doesn't match certificate
  - `SIGNING_FAILED` - Signature generation failed
  - `SIGNATURE_VERIFICATION_FAILED` - Signature verification failed
  - `SIGNING_NOT_CONFIGURED` - Signing required but not configured
  - `SIGNING_DISABLED` - Signing disabled but required
  - `INVALID_DOCUMENT_VERSION` - Invalid document version specified

- **Documentation**
  - Added signing guide (`docs/signing.md`)
  - Added migration guide (`docs/migration-v1.0-to-v1.1.md`)
  - Added signing specification (`docs/signing-specification.md`)
  - Updated README with signing configuration

- **Testing**
  - Unit tests for all signing operations (145+ tests)
  - Integration tests for gateway signing
  - Performance tests (signing latency, concurrent signing, memory usage)
  - Negative tests for error handling

### Changed

- **OpenAPI Specification**
  - Added `DocumentVersion` schema (enum: "1.0", "1.1")
  - Added `documentVersion` to session request/response schemas
  - Added signing error codes to `GatewayError` schema
  - Added `SigningHealthStatus` to readiness response

- **Core Package**
  - Added signing-related error codes to `ErrorCodes`

### Package Versions

| Package | Version | Change |
|---------|---------|--------|
| `@myinvois/signing` | 0.1.0 | New package |
| `@myinvois/gateway` | 0.2.0 | Minor (signing support) |
| `@myinvois/core` | 0.2.0 | Minor (error codes) |
| `@myinvois/contracts` | 0.2.0 | Minor (schemas) |

## [0.1.0] - 2024-XX-XX

### Added

- Initial release
- OAuth2 token caching with automatic refresh
- Rate limiting per MyInvois endpoint
- Document submission with batching (100 docs, 5MB, 300KB limits)
- Background polling worker with BullMQ
- Duplicate detection (10-minute window)
- Error normalization with correlation IDs
- Health check endpoints
- Prometheus metrics
- OpenAPI 3.0 specification
- TypeScript SDK generation

[Unreleased]: https://github.com/zahidaramai/MyInvoice-SDK-Middleware/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zahidaramai/MyInvoice-SDK-Middleware/releases/tag/v0.1.0
