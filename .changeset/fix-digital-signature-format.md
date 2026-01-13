---
"@myinvois/signing": patch
"@myinvois/core": patch
"@myinvois/myinvois-client": patch
---

fix: Correct digital signature format for MyInvois v1.1 compliance

- SignatureValue format changed to `[{ _: signatureBase64 }]` per UBL JSON specification
- QualifyingProperties used instead of XadesQualifyingProperties
- UBLExtensions and Signature elements placed at END of document content
- Signature reference block added to satisfy MyInvois v1.1 requirements
- Both UBLExtensions and Signature now properly excluded from document hash

This resolves MyInvois validation errors DS300 and DS301.
