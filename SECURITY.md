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

## Scope

This policy covers the MyInvois Middleware codebase. For MyInvois API issues, contact LHDN directly.
