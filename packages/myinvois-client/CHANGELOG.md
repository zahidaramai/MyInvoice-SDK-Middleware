# @myinvois/myinvois-client

## 0.2.3

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

- Updated dependencies
  - @myinvois/core@0.1.4

## 0.2.2

### Patch Changes

- 03d35bd: fix: Correct digital signature format for MyInvois v1.1 compliance
  - SignatureValue format changed to `[{ _: signatureBase64 }]` per UBL JSON specification
  - QualifyingProperties used instead of XadesQualifyingProperties
  - UBLExtensions and Signature elements placed at END of document content
  - Signature reference block added to satisfy MyInvois v1.1 requirements
  - Both UBLExtensions and Signature now properly excluded from document hash

  This resolves MyInvois validation errors DS300 and DS301.

- Updated dependencies [03d35bd]
  - @myinvois/core@0.1.3

## 0.2.1

### Patch Changes

- Updated dependencies [81913d7]
  - @myinvois/core@0.1.2

## 0.2.0

### Minor Changes

- 0b530f4: feat(errors): Add comprehensive error normalization for MyInvois validation responses
  - Add unified ErrorEnvelope type for consistent error responses
  - Parse real MyInvois validationSteps structure with innerError arrays
  - Map validation step names (Step03-Step07) to stable error codes
  - Add MSW handlers for negative test scenarios
  - Add 35 error normalizer tests covering all error cases
  - Document error codes, retry strategies, and troubleshooting guide

### Patch Changes

- Updated dependencies [0b530f4]
  - @myinvois/core@0.1.1
