import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/sdks/**", // Exclude generated SDKs
      "**/.deploy/**", // Exclude deployment builds
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json", "html"],
      include: [
        "apps/gateway/src/**/*.ts",
        "apps/worker/src/**/*.ts",
        "packages/core/src/**/*.ts",
        "packages/storage/src/**/*.ts",
        "packages/signing/src/**/*.ts",
        "packages/contracts/src/**/*.ts",
        "packages/myinvois-client/src/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "**/index.ts", // Re-export files
        "**/types.ts", // Type-only files
        "**/sdks/**",
        "**/models/**", // Generated SDK models
        "**/apis/**", // Generated SDK APIs
        "**/server.ts", // Entry points
        "**/main.ts", // Entry points
        "apps/gateway/src/config.ts", // Config loading
        "apps/gateway/src/config/**", // Config files
        "packages/myinvois-client/src/*-client.ts", // Auto-generated clients
      ],
    },
    // Global setup for Testcontainers (E2E tests)
    // Set SKIP_TESTCONTAINERS=true to skip for unit tests only
    globalSetup: process.env.SKIP_TESTCONTAINERS === "true" ? undefined : ["./test/globalSetup.ts"],
    globalTeardown:
      process.env.SKIP_TESTCONTAINERS === "true" ? undefined : ["./test/globalTeardown.ts"],
    // Increase timeout for E2E tests with containers
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
