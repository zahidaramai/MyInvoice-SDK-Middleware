# MyInvois Middleware Gateway - Claude Code Guidelines

## Project Overview

This is an **OpenAPI-first, Node.js/TypeScript middleware gateway** that simplifies integration with Malaysia's MyInvois e-invoicing system. The project transforms MyInvois' complex ERP-integration requirements into a clean, stable, OSS-friendly API.

### Core Value Proposition

The gateway provides these critical capabilities:
- **Token caching** - Cache OAuth tokens for ~60 minutes (avoid re-auth per call)
- **Rate-limit safety** - Enforce MyInvois RPM caps per endpoint
- **Submission orchestration** - Handle batching constraints (5MB/100 docs/300KB)
- **Polling worker** - Background status polling via Get Submission API (3-5s intervals)
- **Normalized errors** - Consistent error envelope with correlationId + Retry-After

### Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **Framework**: Fastify (HTTP gateway)
- **Queue**: BullMQ + Redis (polling worker)
- **Database**: PostgreSQL (prod) / SQLite (dev) via Prisma
- **Package Manager**: pnpm workspaces (monorepo)
- **Testing**: Vitest
- **API Contract**: OpenAPI 3.0.3 with Spectral linting

---

## Repository Structure

```
/
├── openapi/openapi.yaml       # Source of truth - API contract
├── .spectral.yaml             # OpenAPI linting rules
├── apps/
│   ├── gateway/               # Fastify HTTP gateway server
│   └── worker/                # BullMQ polling worker
├── packages/
│   ├── contracts/             # Zod schemas + OpenAPI helpers
│   ├── core/                  # Rate limiter, error normalization, hashing
│   ├── myinvois-client/       # Typed client for MyInvois endpoints
│   └── storage/               # Prisma + database adapters
├── docker/                    # Docker compose configs
├── docs/                      # PRD, playbook, phase documentation
└── clients/                   # Generated SDK clients (future)
```

---

## MyInvois Integration Rules (NON-NEGOTIABLE)

These rules are mandated by LHDN's MyInvois SDK documentation and must be strictly followed:

### Authentication

| Rule | Implementation |
|------|----------------|
| Token lifetime | Cache tokens for ~60 minutes (expires_in from response) |
| Refresh strategy | Refresh on 401 Unauthorized, not proactively |
| Login RPM | 12 RPM per clientId for login endpoints |
| Intermediary mode | Requires `onbehalfof` header (TIN or TIN:ROB format) |

### Submission Constraints

| Constraint | Limit |
|------------|-------|
| Documents per submission | Max 100 |
| Submission size | Max 5 MB |
| Document size | Max 300 KB each |
| Duplicate window | 10 minutes - return cached result, don't resubmit |
| Submit RPM | 100 RPM per clientId |

### Status Monitoring

| Rule | Implementation |
|------|----------------|
| Polling API | Use **Get Submission** API only (NOT Get Document/Details/Recent/Search) |
| Polling interval | 3-5 seconds minimum between polls |
| Polling RPM | 300 RPM per clientId |
| Terminal states | Stop polling when VALID, INVALID, or CANCELLED |

### Error Handling

| Error | Behavior |
|-------|----------|
| 429 TooManyRequests | Respect `Retry-After` header, do not auto-retry |
| 422 DuplicateSubmission | Surface with `Retry-After`, store for dedupe |
| 401 Unauthorized | Refresh token once, then propagate error |
| correlationId | Always capture and log from response headers |

### Anti-Patterns (NEVER DO)

- **DO NOT** request a new token for every API call
- **DO NOT** use Get Document/Details/Search/Recent for submission monitoring
- **DO NOT** poll more frequently than 3 seconds
- **DO NOT** exceed endpoint-specific RPM limits
- **DO NOT** log secrets, tokens, or document contents
- **DO NOT** auto-resubmit after receiving any 2xx response
- **DO NOT** modify signed documents (base64/hash are caller-provided)

---

## Development Phases

The project follows a phased implementation approach. Current phase status:

| Phase | Name | Status |
|-------|------|--------|
| 00 | Bootstrap & Governance | Complete |
| 01 | Contract-first (OpenAPI + Spectral) | Complete |
| 02 | Gateway Skeleton | Complete |
| 03 | Upstream Auth + Rate-limit Core | Complete |
| 04 | Submit Documents Orchestration | **In Progress** |
| 05 | Polling Worker + Get Submission | Pending |
| 06 | Document State + Details | Pending |
| 07 | TIN Validate + Cache | Pending |
| 08 | Observability + Hardening | Pending |
| 09 | CI/CD + SDK Generation | Pending |
| 10 | Docs, Examples, Releases | Pending |

Refer to `docs/Phase{XX}.md` for detailed requirements per phase.

---

## Code Conventions

### TypeScript

```typescript
// Use strict types - no `any` unless absolutely necessary
// Prefer interfaces over type aliases for objects
// Use Zod for runtime validation

// Environment types
type Environment = "PROD" | "SANDBOX";
type Mode = "TAXPAYER" | "INTERMEDIARY";

// Session patterns
const sessionId = `sess_${generateId()}`;  // Pattern: sess_[a-zA-Z0-9]+
const trackingId = `trk_${generateId()}`;  // Pattern: trk_[a-zA-Z0-9]+
```

### Error Envelope

All errors MUST use the stable `GatewayError` shape:

```typescript
interface GatewayError {
  correlationId?: string;      // From MyInvois response header
  httpStatus: number;
  errorCode?: string;
  propertyName?: string | null;
  propertyPath?: string | null;
  target?: string | null;
  messageEN: string;
  messageMS?: string;
  inner?: GatewayError[];
  retryAfterSeconds?: number;
  upstream?: { service: "MYINVOIS"; path: string };
}
```

### Logging

```typescript
// ALWAYS include correlationId in logs
logger.info({ correlationId, trackingId, submissionUid }, "Submission created");

// NEVER log these
// - clientSecret, access_token, refresh_token
// - document contents (rawDocument, documentBase64)
// - full request/response bodies in production
```

### Testing

```typescript
// Use Vitest for all tests
// Mock upstream APIs with msw or nock
// Never call real MyInvois endpoints in tests
// Test file naming: *.test.ts next to source

describe("submitDocuments", () => {
  it("returns 202 with tracking ID on success", async () => {
    // Mock upstream
    // Call handler
    // Assert response shape matches OpenAPI
  });
});
```

---

## Commands Reference

```bash
# Development
pnpm install              # Install all dependencies
pnpm dev                  # Start gateway in dev mode (apps/gateway)
pnpm build                # Build all packages
pnpm typecheck            # Type check all packages

# Testing
pnpm test                 # Run all tests
pnpm test:watch           # Watch mode

# Quality
pnpm lint                 # ESLint all packages
pnpm format               # Prettier format
pnpm format:check         # Check formatting
pnpm check                # Run lint + typecheck + test + build

# OpenAPI
npx @stoplight/spectral-cli lint openapi/openapi.yaml

# Database (when Prisma is set up)
pnpm --filter @myinvois/storage prisma migrate dev
pnpm --filter @myinvois/storage prisma generate
```

---

## When Implementing Features

### Before Starting

1. Read the relevant phase document in `docs/Phase{XX}.md`
2. Check if the feature is defined in `openapi/openapi.yaml`
3. Understand the MyInvois SDK documentation for the endpoint
4. Verify rate limits and constraints apply

### Implementation Checklist

- [ ] Matches OpenAPI contract exactly
- [ ] Respects MyInvois rate limits
- [ ] Includes correlationId handling
- [ ] Uses normalized error envelope
- [ ] Has unit tests with mocked upstream
- [ ] No secrets/tokens logged
- [ ] Passes `pnpm check`

### File Placement

| Logic Type | Location |
|------------|----------|
| Route handlers | `apps/gateway/src/routes/` |
| MyInvois API calls | `packages/myinvois-client/src/` |
| Database operations | `packages/storage/src/` |
| Shared utilities | `packages/core/src/` |
| Type definitions | `packages/contracts/src/` |

---

## Common Tasks

### Adding a New Endpoint

1. Define in `openapi/openapi.yaml` first
2. Run Spectral lint: `npx @stoplight/spectral-cli lint openapi/openapi.yaml`
3. Create route handler in `apps/gateway/src/routes/`
4. Add upstream client method in `packages/myinvois-client/` if needed
5. Write tests
6. Update README if behavior is user-facing

### Modifying the OpenAPI Spec

1. Edit `openapi/openapi.yaml`
2. Ensure it passes Spectral lint
3. Update any affected route handlers
4. Regenerate SDK clients if set up
5. Update changelog

### Adding Database Models

1. Edit `packages/storage/prisma/schema.prisma`
2. Run `pnpm --filter @myinvois/storage prisma migrate dev`
3. Create repository functions in `packages/storage/src/repositories/`
4. Write tests

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Gateway HTTP port | 3000 |
| `LOG_LEVEL` | Logging level | info |
| `NODE_ENV` | Environment mode | development |
| `DATABASE_URL` | Prisma database connection | - |
| `REDIS_URL` | Redis connection for BullMQ | - |
| `MYINVOIS_ENV` | Target environment (PROD/SANDBOX) | SANDBOX |
| `VALIDATE_UPSTREAM` | Test auth on session create | false |

---

## OpenAPI Contract Rules

The `openapi/openapi.yaml` is the source of truth. Code MUST conform to spec.

### Spectral Rules Enforced

- All operations require `operationId`
- All operations require `tags`
- All operations require at least one 2xx response
- All v1 paths must start with `/v1` (except health endpoints)
- All operations must define 429 response

### Response Patterns

```yaml
# Success responses include X-Correlation-Id header
responses:
  "200":
    headers:
      X-Correlation-Id:
        $ref: "#/components/headers/X-Correlation-Id"

# Rate limit responses include Retry-After
responses:
  "429":
    headers:
      Retry-After:
        $ref: "#/components/headers/Retry-After"
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Token expires frequently | Check TokenManager caches for full `expires_in` duration |
| 429 TooManyRequests | Check rate limiter config matches MyInvois RPM limits |
| Polling not updating | Verify using Get Submission API, not document APIs |
| Missing correlationId | Ensure capturing from response headers, not body |

### Debug Logging

```typescript
// Enable verbose logging in development
LOG_LEVEL=debug pnpm dev
```

---

## Contributing

1. Follow the phase documentation for current scope
2. Ensure OpenAPI spec is updated for API changes
3. Write tests for all new functionality
4. Never commit secrets or credentials
5. Run `pnpm check` before pushing

See `CONTRIBUTING.md` for full guidelines.

---

## Key Documentation

| Document | Purpose |
|----------|---------|
| [docs/PRD.md](docs/PRD.md) | Product requirements and goals |
| [docs/MasterPlaybook.md](docs/MasterPlaybook.md) | Phase roadmap and implementation plan |
| [docs/Phase{XX}.md](docs/) | Detailed phase execution prompts |
| [openapi/openapi.yaml](openapi/openapi.yaml) | API contract (source of truth) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [DISCLAIMER.md](DISCLAIMER.md) | Legal disclaimers |

---

## External References

- [MyInvois SDK - Integration Practices](https://sdk.myinvois.hasil.gov.my/integration-practices/)
- [MyInvois SDK - Submit Documents](https://sdk.myinvois.hasil.gov.my/einvoicingapi/02-submit-documents/)
- [MyInvois SDK - Get Submission](https://sdk.myinvois.hasil.gov.my/einvoicingapi/06-get-submission/)
- [MyInvois SDK - Standard Error Response](https://sdk.myinvois.hasil.gov.my/standard-error-response/)
- [MyInvois SDK - Standard Headers](https://sdk.myinvois.hasil.gov.my/standard-header-parameters/)
