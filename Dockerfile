# HashLHDN MyInvois Gateway - Production Dockerfile
# Multi-stage build for optimized production image

# ===== Stage 1: Builder =====
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/gateway/package.json ./apps/gateway/
COPY packages/core/package.json ./packages/core/
COPY packages/signing/package.json ./packages/signing/
COPY packages/myinvois-client/package.json ./packages/myinvois-client/
COPY packages/storage/package.json ./packages/storage/
COPY packages/contracts/package.json ./packages/contracts/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN pnpm --filter @myinvois/storage prisma generate

# Build all packages
RUN pnpm build

# ===== Stage 2: Production =====
FROM node:20-alpine AS production

# Install pnpm and dumb-init for proper signal handling
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate \
    && apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/gateway/package.json ./apps/gateway/
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/signing/package.json ./packages/signing/
COPY --from=builder /app/packages/myinvois-client/package.json ./packages/myinvois-client/
COPY --from=builder /app/packages/storage/package.json ./packages/storage/
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/signing/dist ./packages/signing/dist
COPY --from=builder /app/packages/myinvois-client/dist ./packages/myinvois-client/dist
COPY --from=builder /app/packages/storage/dist ./packages/storage/dist
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist

# Copy Prisma schema and generated client
COPY --from=builder /app/packages/storage/prisma ./packages/storage/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Create directory for certificates
RUN mkdir -p /app/certs && chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

# Start server
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/gateway/dist/server.js"]
