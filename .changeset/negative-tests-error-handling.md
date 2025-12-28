---
"@myinvois/myinvois-client": minor
"@myinvois/core": patch
---

feat(errors): Add comprehensive error normalization for MyInvois validation responses

- Add unified ErrorEnvelope type for consistent error responses
- Parse real MyInvois validationSteps structure with innerError arrays
- Map validation step names (Step03-Step07) to stable error codes
- Add MSW handlers for negative test scenarios
- Add 35 error normalizer tests covering all error cases
- Document error codes, retry strategies, and troubleshooting guide
