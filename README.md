# MyInvois Middleware

Open-source middleware gateway for Malaysia's MyInvois e-invoicing system. Provides a simplified REST API layer between your applications and the official LHDN MyInvois API.

> **Note**: This is an unofficial community project. See [DISCLAIMER.md](DISCLAIMER.md).

## Prerequisites

- **Node.js 22** (LTS recommended) - also compatible with Node 20
- **pnpm** (v9+)
- **Docker** (for local postgres/redis)

## Getting Started

```bash
# Install dependencies
pnpm install

# Run all checks (lint, typecheck, test, build)
pnpm check

# Start local infrastructure
docker compose -f docker/docker-compose.yml up -d

# Check services are running
docker compose -f docker/docker-compose.yml ps
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm lint` | Run ESLint across all packages |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run all tests with Vitest |
| `pnpm build` | Build all packages |
| `pnpm format` | Format code with Prettier |
| `pnpm check` | Run lint + typecheck + test + build |

## API Contract

The OpenAPI specification is the source of truth for the gateway API.

**Location**: [openapi/openapi.yaml](openapi/openapi.yaml)

### Lint the spec locally

```bash
npx @stoplight/spectral-cli lint openapi/openapi.yaml --ruleset .spectral.yaml
```

### Contract governance

- All API changes must be reflected in `openapi/openapi.yaml` first
- Spectral linting enforces style and quality rules
- CI blocks PRs with spec violations
- Breaking changes require explicit documentation

### Endpoints overview

| Category | Endpoints |
|----------|-----------|
| Health | `GET /healthz`, `GET /readyz`, `GET /version` |
| Sessions | `POST /v1/sessions`, `GET/DELETE /v1/sessions/{id}` |
| Submissions | `POST /v1/submissions`, `GET /v1/submissions/{id}`, `POST .../poll` |
| Documents | `POST /v1/documents/{uuid}/cancel`, `.../reject`, `GET .../details` |
| Taxpayer | `GET /v1/tin/validate` |

## Repository Structure

```
├── apps/
│   ├── gateway/       # REST API gateway (Fastify)
│   └── worker/        # Background job processor (BullMQ)
├── packages/
│   ├── core/          # Shared business logic
│   ├── myinvois-client/  # MyInvois API client
│   ├── storage/       # Database & cache abstractions
│   └── contracts/     # Shared types & schemas
├── openapi/           # OpenAPI specifications
├── docker/            # Docker compose for local dev
└── docs/              # Documentation
```

## Local Development

1. Copy environment template: `cp .env.example .env`
2. Start infrastructure: `docker compose -f docker/docker-compose.yml up -d`
3. Run the gateway: `pnpm --filter gateway dev`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE)
