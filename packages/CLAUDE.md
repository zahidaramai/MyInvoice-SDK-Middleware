# Packages Directory - Claude Code Guidelines

This directory contains shared libraries used by the gateway and worker applications.

## Packages Overview

| Package | Purpose | Key Exports |
|---------|---------|-------------|
| `contracts/` | Zod schemas + types | Request/response types, validators |
| `core/` | Shared utilities | Rate limiter, error normalization, hashing |
| `myinvois-client/` | MyInvois API client | Auth, submit, polling, state changes |
| `storage/` | Database layer | Prisma client, repositories |

---

## Package Dependencies

```
contracts (no deps)
    ↑
   core (depends on contracts)
    ↑
myinvois-client (depends on core, contracts)
    ↑
  storage (depends on core, contracts)
    ↑
apps/gateway, apps/worker (depend on all)
```

**Rule**: Lower packages MUST NOT depend on higher packages.

---

## Contracts (`packages/contracts`)

Defines the TypeScript types and Zod schemas shared across the codebase.

### Structure

```
packages/contracts/
├── src/
│   ├── index.ts              # Barrel exports
│   ├── schemas/              # Zod schemas
│   │   ├── session.ts
│   │   ├── submission.ts
│   │   ├── document.ts
│   │   ├── error.ts
│   │   └── taxpayer.ts
│   ├── types/                # TypeScript types
│   │   ├── environment.ts
│   │   ├── mode.ts
│   │   └── common.ts
│   └── openapi/              # OpenAPI helpers (optional)
├── package.json
└── tsconfig.json
```

### Core Types

```typescript
// types/environment.ts
export type Environment = "PROD" | "SANDBOX";

export const MYINVOIS_HOSTS: Record<Environment, MyInvoisHosts> = {
  PROD: {
    portalBase: "https://myinvois.hasil.gov.my",
    systemApiBase: "https://api.myinvois.hasil.gov.my",
    identityApiBase: "https://api.myinvois.hasil.gov.my"
  },
  SANDBOX: {
    portalBase: "https://preprod.myinvois.hasil.gov.my",
    systemApiBase: "https://preprod-api.myinvois.hasil.gov.my",
    identityApiBase: "https://preprod-api.myinvois.hasil.gov.my"
  }
};

// types/mode.ts
export type Mode = "TAXPAYER" | "INTERMEDIARY";
```

### Zod Schemas

```typescript
// schemas/session.ts
import { z } from 'zod';

export const SessionCreateTaxpayerSchema = z.object({
  env: z.enum(['PROD', 'SANDBOX']),
  mode: z.literal('TAXPAYER'),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1)
});

export const SessionCreateIntermediarySchema = z.object({
  env: z.enum(['PROD', 'SANDBOX']),
  mode: z.literal('INTERMEDIARY'),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  onBehalfOf: z.string().regex(/^[A-Z0-9]+(:.*)?$/)
});

export const SessionCreateRequestSchema = z.discriminatedUnion('mode', [
  SessionCreateTaxpayerSchema,
  SessionCreateIntermediarySchema
]);

export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;

// schemas/submission.ts
export const DocumentInputSchema = z.object({
  format: z.enum(['XML', 'JSON']),
  codeNumber: z.string().min(1),
  rawDocument: z.string().optional(),
  documentBase64: z.string().optional(),
  documentHashSha256: z.string().optional()
}).refine(
  data => data.rawDocument || (data.documentBase64 && data.documentHashSha256),
  { message: 'Either rawDocument or both documentBase64 and documentHashSha256 required' }
);

export const SubmissionCreateRequestSchema = z.object({
  sessionId: z.string().regex(/^sess_[a-zA-Z0-9]+$/),
  documents: z.array(DocumentInputSchema).min(1).max(100),
  autoMinify: z.boolean().default(false),
  asyncPolling: z.boolean().default(true)
});
```

### Error Schema

```typescript
// schemas/error.ts
export const GatewayErrorSchema = z.object({
  correlationId: z.string().optional(),
  httpStatus: z.number().int(),
  errorCode: z.string().optional(),
  propertyName: z.string().nullable().optional(),
  propertyPath: z.string().nullable().optional(),
  target: z.string().nullable().optional(),
  messageEN: z.string(),
  messageMS: z.string().optional(),
  inner: z.array(z.lazy(() => GatewayErrorSchema)).optional(),
  retryAfterSeconds: z.number().int().min(0).optional(),
  upstream: z.object({
    service: z.literal('MYINVOIS'),
    path: z.string()
  }).optional()
});

export type GatewayError = z.infer<typeof GatewayErrorSchema>;
```

---

## Core (`packages/core`)

Shared utilities used across gateway and worker.

### Structure

```
packages/core/
├── src/
│   ├── index.ts
│   ├── rateLimit/
│   │   ├── RateLimiter.ts
│   │   ├── InMemoryStore.ts
│   │   └── RedisStore.ts
│   ├── errors/
│   │   ├── normalize.ts
│   │   └── GatewayError.ts
│   ├── crypto/
│   │   ├── hash.ts
│   │   └── encoding.ts
│   ├── id/
│   │   └── generate.ts
│   └── logging/
│       └── logger.ts
├── package.json
└── tsconfig.json
```

### Rate Limiter

```typescript
// rateLimit/RateLimiter.ts

interface RateLimitConfig {
  maxRequests: number;  // Max requests per window
  windowMs: number;     // Window size in milliseconds
}

interface RateLimitStore {
  increment(key: string): Promise<{ count: number; resetAt: number }>;
  get(key: string): Promise<{ count: number; resetAt: number } | null>;
}

// MyInvois RPM limits (per endpoint, per clientId)
export const MYINVOIS_RATE_LIMITS: Record<string, RateLimitConfig> = {
  login: { maxRequests: 12, windowMs: 60000 },
  submit: { maxRequests: 100, windowMs: 60000 },
  getSubmission: { maxRequests: 300, windowMs: 60000 },
  cancel: { maxRequests: 12, windowMs: 60000 },
  reject: { maxRequests: 12, windowMs: 60000 }
};

export class RateLimiter {
  constructor(
    private config: RateLimitConfig,
    private store: RateLimitStore
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const result = await this.store.get(key);
    if (!result) {
      return { allowed: true, remaining: this.config.maxRequests - 1 };
    }

    if (result.count >= this.config.maxRequests) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter };
    }

    return { allowed: true, remaining: this.config.maxRequests - result.count - 1 };
  }

  async consume(key: string): Promise<RateLimitResult> {
    const result = await this.store.increment(key);
    // ... similar logic
  }
}
```

### Error Normalization

```typescript
// errors/normalize.ts

interface UpstreamError {
  correlationId?: string;
  status: number;
  code?: string;
  message?: string;
  error?: string;
  errorMS?: string;
  propertyName?: string;
  propertyPath?: string;
  target?: string;
  innerError?: UpstreamError[];
}

export function normalizeUpstreamError(
  error: UpstreamError,
  path: string
): GatewayError {
  return {
    correlationId: error.correlationId,
    httpStatus: error.status,
    errorCode: error.code,
    messageEN: error.message || error.error || 'Unknown upstream error',
    messageMS: error.errorMS,
    propertyName: error.propertyName,
    propertyPath: error.propertyPath,
    target: error.target,
    inner: error.innerError?.map(e => normalizeUpstreamError(e, path)),
    upstream: { service: 'MYINVOIS', path }
  };
}

export function normalizeHttpError(
  status: number,
  message: string,
  options?: Partial<GatewayError>
): GatewayError {
  return {
    httpStatus: status,
    messageEN: message,
    ...options
  };
}
```

### Crypto Utilities

```typescript
// crypto/hash.ts
import crypto from 'crypto';

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function sha256Base64(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('base64');
}

// crypto/encoding.ts
export function toBase64(data: string): string {
  return Buffer.from(data, 'utf-8').toString('base64');
}

export function fromBase64(data: string): string {
  return Buffer.from(data, 'base64').toString('utf-8');
}

export function estimateBase64Size(base64: string): number {
  // Base64 size = ceil(original_size * 4/3)
  // So original_size = floor(base64_size * 3/4)
  const padding = (base64.match(/=/g) || []).length;
  return Math.floor((base64.length * 3) / 4) - padding;
}
```

### ID Generation

```typescript
// id/generate.ts
import crypto from 'crypto';

export function generateSessionId(): string {
  return `sess_${crypto.randomBytes(16).toString('hex')}`;
}

export function generateTrackingId(): string {
  return `trk_${crypto.randomBytes(16).toString('hex')}`;
}

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}
```

---

## MyInvois Client (`packages/myinvois-client`)

Typed client for interacting with MyInvois APIs.

### Structure

```
packages/myinvois-client/
├── src/
│   ├── index.ts
│   ├── client.ts              # Main client class
│   ├── auth/
│   │   ├── TokenManager.ts
│   │   └── types.ts
│   ├── einvoice/
│   │   ├── submitDocuments.ts
│   │   ├── getSubmission.ts
│   │   ├── cancelDocument.ts
│   │   ├── rejectDocument.ts
│   │   └── getDocumentDetails.ts
│   ├── taxpayer/
│   │   └── validateTin.ts
│   ├── errors/
│   │   └── MyInvoisError.ts
│   └── http/
│       └── request.ts
├── package.json
└── tsconfig.json
```

### Token Manager

```typescript
// auth/TokenManager.ts

interface TokenCacheKey {
  env: Environment;
  clientId: string;
  onBehalfOf?: string;  // For intermediary mode
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;  // Unix timestamp
}

export class TokenManager {
  private cache = new Map<string, CachedToken>();

  private getCacheKey(key: TokenCacheKey): string {
    return `${key.env}:${key.clientId}:${key.onBehalfOf || ''}`;
  }

  async getToken(session: SessionContext): Promise<string> {
    const cacheKey = this.getCacheKey({
      env: session.env,
      clientId: session.clientId,
      onBehalfOf: session.onBehalfOf
    });

    const cached = this.cache.get(cacheKey);

    // Return if valid (with 60s buffer)
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return cached.accessToken;
    }

    // Request new token
    const token = await this.requestToken(session);

    // Cache for expires_in duration
    this.cache.set(cacheKey, {
      accessToken: token.access_token,
      expiresAt: Date.now() + (token.expires_in * 1000)
    });

    return token.access_token;
  }

  private async requestToken(session: SessionContext): Promise<TokenResponse> {
    const url = `${MYINVOIS_HOSTS[session.env].identityApiBase}/connect/token`;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: session.clientId,
      client_secret: session.clientSecret,
      scope: 'InvoicingAPI'
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    // Intermediary mode requires onbehalfof header
    if (session.mode === 'INTERMEDIARY' && session.onBehalfOf) {
      headers['onbehalfof'] = session.onBehalfOf;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body
    });

    if (!response.ok) {
      throw new MyInvoisAuthError(response.status, await response.text());
    }

    return response.json();
  }

  // Call on 401 to force refresh
  invalidate(session: SessionContext): void {
    const cacheKey = this.getCacheKey({
      env: session.env,
      clientId: session.clientId,
      onBehalfOf: session.onBehalfOf
    });
    this.cache.delete(cacheKey);
  }
}
```

### Submit Documents

```typescript
// einvoice/submitDocuments.ts

interface SubmitDocumentsInput {
  documents: Array<{
    format: 'XML' | 'JSON';
    document: string;      // Base64 encoded
    documentHash: string;  // SHA256 hash
    codeNumber: string;
  }>;
}

interface SubmitDocumentsResult {
  submissionUid: string;
  correlationId: string;
  acceptedDocuments: Array<{ uuid: string; invoiceCodeNumber: string }>;
  rejectedDocuments: Array<{
    invoiceCodeNumber: string;
    error: { code: string; message: string };
  }>;
}

export async function submitDocuments(
  session: SessionContext,
  input: SubmitDocumentsInput,
  tokenManager: TokenManager,
  rateLimiter: RateLimiter
): Promise<SubmitDocumentsResult> {
  // Check rate limit (100 RPM)
  const rateCheck = await rateLimiter.check(`submit:${session.clientId}`);
  if (!rateCheck.allowed) {
    throw new RateLimitError(rateCheck.retryAfterSeconds!);
  }

  const token = await tokenManager.getToken(session);

  const url = `${MYINVOIS_HOSTS[session.env].systemApiBase}/api/v1.0/documentsubmissions/`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ documents: input.documents })
  });

  // Consume rate limit on successful request
  await rateLimiter.consume(`submit:${session.clientId}`);

  const correlationId = response.headers.get('correlationid') || '';

  if (response.status === 401) {
    // Invalidate and retry once
    tokenManager.invalidate(session);
    const newToken = await tokenManager.getToken(session);
    // Retry with new token...
  }

  if (response.status === 422) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '0');
    throw new DuplicateSubmissionError(correlationId, retryAfter);
  }

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '60');
    throw new RateLimitError(retryAfter, correlationId);
  }

  if (!response.ok) {
    const error = await response.json();
    throw new MyInvoisApiError(response.status, error, correlationId);
  }

  const result = await response.json();
  return { ...result, correlationId };
}
```

### Get Submission (for Polling)

```typescript
// einvoice/getSubmission.ts

interface GetSubmissionResult {
  submissionUid: string;
  overallStatus: 'In Progress' | 'Valid' | 'Partially Valid' | 'Invalid';
  correlationId: string;
  documentSummary: Array<{
    uuid: string;
    submissionUid: string;
    longId?: string;
    internalId: string;
    dateTimeIssued: string;
    dateTimeReceived: string;
    dateTimeValidated?: string;
    status: string;
  }>;
}

export async function getSubmission(
  session: SessionContext,
  submissionUid: string,
  tokenManager: TokenManager,
  rateLimiter: RateLimiter
): Promise<GetSubmissionResult> {
  // Rate limit: 300 RPM
  const rateCheck = await rateLimiter.check(`getSubmission:${session.clientId}`);
  if (!rateCheck.allowed) {
    throw new RateLimitError(rateCheck.retryAfterSeconds!);
  }

  const token = await tokenManager.getToken(session);

  const url = `${MYINVOIS_HOSTS[session.env].systemApiBase}/api/v1.0/documentsubmissions/${submissionUid}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  await rateLimiter.consume(`getSubmission:${session.clientId}`);

  const correlationId = response.headers.get('correlationid') || '';

  // Handle errors...

  const result = await response.json();
  return { ...result, correlationId };
}
```

---

## Storage (`packages/storage`)

Database layer using Prisma.

### Structure

```
packages/storage/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── index.ts
│   ├── client.ts              # Prisma client singleton
│   └── repositories/
│       ├── sessions.ts
│       ├── submissions.ts
│       └── documents.ts
├── package.json
└── tsconfig.json
```

### Prisma Schema

```prisma
// prisma/schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Session {
  id           String      @id @default(uuid())
  env          Environment
  mode         Mode
  clientId     String
  onBehalfOf   String?
  createdAt    DateTime    @default(now())
  expiresAt    DateTime?
  submissions  Submission[]

  @@index([clientId])
}

model Submission {
  trackingId           String             @id @default(uuid())
  sessionId            String
  session              Session            @relation(fields: [sessionId], references: [id])
  env                  Environment
  payloadHash          String
  upstreamSubmissionUid String?
  status               SubmissionStatus   @default(RECEIVED)
  upstreamOverallStatus String?
  correlationId        String?
  retryAfterSeconds    Int?
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
  documents            SubmissionDocument[]

  @@unique([sessionId, payloadHash])
  @@index([sessionId, createdAt])
  @@index([upstreamSubmissionUid])
}

model SubmissionDocument {
  id                   String           @id @default(uuid())
  submissionTrackingId String
  submission           Submission       @relation(fields: [submissionTrackingId], references: [trackingId])
  codeNumber           String
  upstreamUuid         String?
  initialResult        DocumentResult?
  errorCode            String?
  errorMessage         String?
  createdAt            DateTime         @default(now())

  @@index([submissionTrackingId])
  @@index([upstreamUuid])
}

enum Environment {
  PROD
  SANDBOX
}

enum Mode {
  TAXPAYER
  INTERMEDIARY
}

enum SubmissionStatus {
  RECEIVED
  SUBMITTED
  PROCESSING
  VALID
  INVALID
  CANCELLED
  DUPLICATE_SUPPRESSED
  ERROR
}

enum DocumentResult {
  ACCEPTED
  REJECTED
}
```

### Submissions Repository

```typescript
// repositories/submissions.ts

export class SubmissionsRepository {
  constructor(private prisma: PrismaClient) {}

  async create(input: {
    sessionId: string;
    env: Environment;
    payloadHash: string;
  }): Promise<Submission> {
    return this.prisma.submission.create({
      data: {
        trackingId: generateTrackingId(),
        sessionId: input.sessionId,
        env: input.env,
        payloadHash: input.payloadHash,
        status: 'RECEIVED'
      }
    });
  }

  async findRecentByPayloadHash(
    sessionId: string,
    payloadHash: string,
    withinMinutes: number = 10
  ): Promise<Submission | null> {
    const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000);

    return this.prisma.submission.findFirst({
      where: {
        sessionId,
        payloadHash,
        createdAt: { gte: cutoff }
      },
      include: { documents: true }
    });
  }

  async attachUpstreamResult(
    trackingId: string,
    result: {
      submissionUid: string;
      correlationId: string;
      acceptedDocuments: Array<{ codeNumber: string; uuid: string }>;
      rejectedDocuments: Array<{ codeNumber: string; error: any }>;
    }
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.submission.update({
        where: { trackingId },
        data: {
          upstreamSubmissionUid: result.submissionUid,
          correlationId: result.correlationId,
          status: 'SUBMITTED'
        }
      }),
      ...result.acceptedDocuments.map(doc =>
        this.prisma.submissionDocument.create({
          data: {
            submissionTrackingId: trackingId,
            codeNumber: doc.codeNumber,
            upstreamUuid: doc.uuid,
            initialResult: 'ACCEPTED'
          }
        })
      ),
      ...result.rejectedDocuments.map(doc =>
        this.prisma.submissionDocument.create({
          data: {
            submissionTrackingId: trackingId,
            codeNumber: doc.codeNumber,
            initialResult: 'REJECTED',
            errorCode: doc.error?.code,
            errorMessage: doc.error?.message
          }
        })
      )
    ]);
  }

  async updateStatus(
    trackingId: string,
    status: SubmissionStatus,
    upstreamStatus?: string
  ): Promise<void> {
    await this.prisma.submission.update({
      where: { trackingId },
      data: { status, upstreamOverallStatus: upstreamStatus }
    });
  }
}
```

---

## Package Development Guidelines

### Adding a New Package

1. Create directory under `packages/`
2. Initialize with `package.json`:

```json
{
  "name": "@myinvois/new-package",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts",
    "test": "vitest run"
  }
}
```

3. Create `tsconfig.json` extending root
4. Add to pnpm workspace

### Testing Packages

```typescript
// Each package should have index.test.ts at minimum
// Use Vitest for testing

import { describe, it, expect } from 'vitest';
import { sha256, toBase64 } from './index';

describe('crypto', () => {
  it('generates consistent sha256 hash', () => {
    expect(sha256('test')).toBe('9f86d081...');
  });
});
```

### Exports

```typescript
// src/index.ts - Barrel export pattern
export * from './rateLimit/RateLimiter';
export * from './errors/normalize';
export * from './crypto/hash';
export * from './crypto/encoding';
export * from './id/generate';
```

---

## Common Patterns

### Error Handling Across Packages

```typescript
// All packages use core error types
import { GatewayError, normalizeHttpError } from '@myinvois/core';

// Wrap upstream errors consistently
try {
  await upstreamCall();
} catch (error) {
  if (error instanceof MyInvoisApiError) {
    throw normalizeUpstreamError(error, '/api/v1.0/...');
  }
  throw error;
}
```

### Dependency Injection

```typescript
// Prefer constructor injection for testability
export class SubmissionsRepository {
  constructor(private prisma: PrismaClient) {}
}

// In tests
const mockPrisma = createMockPrisma();
const repo = new SubmissionsRepository(mockPrisma);
```

---

## References

- [Root CLAUDE.md](../CLAUDE.md) - Project guidelines
- [Prisma Documentation](https://www.prisma.io/docs)
- [Zod Documentation](https://zod.dev)
