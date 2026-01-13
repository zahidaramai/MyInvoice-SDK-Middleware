# Security Policy

## Supported Versions

We release security patches for the latest minor version only.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead:

1. Open a [GitHub Security Advisory](../../security/advisories/new) (preferred)
2. Or email the maintainers privately

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- Acknowledgment: within 48 hours
- Initial assessment: within 7 days
- Fix timeline: depends on severity

## Credential Safety

- Never commit secrets, API keys, or certificates
- Use environment variables for all sensitive config
- The `.env` file is gitignored; use `.env.example` as a template
- Review PRs for accidental credential exposure

## Digital Signing Security

The middleware supports X.509 certificate-based document signing. Follow these practices:

### Private Key Protection

- Never commit private keys to version control
- Use environment variables (`SIGNING_KEY_BASE64`) or mounted secrets in containers
- Restrict file permissions: `chmod 600 private-key.pem`
- Private keys are never logged by the middleware

### Certificate Handling

- Certificates are validated for expiry on startup
- Certificate content (public key, subject) may appear in logs for debugging
- Private keys are never logged or exposed in any API responses
- Test fixtures use self-signed certificates with obvious "Test" identifiers

### Sensitive Data Logging

The middleware redacts the following from all logs:
- Private keys
- Client secrets
- Access tokens
- Document content (base64 payloads)

### Test Fixtures

All test certificates and keys in `packages/signing/test/fixtures/` are:
- Self-signed for testing purposes only
- Contain "Test Organization" in the subject
- Not valid for production use

## Scope

This policy covers the MyInvois Middleware codebase. For MyInvois API issues, contact LHDN directly.
