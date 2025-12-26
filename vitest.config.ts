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
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    // Global setup for Testcontainers (E2E tests)
    // Set SKIP_TESTCONTAINERS=true to skip for unit tests only
    globalSetup: process.env.SKIP_TESTCONTAINERS === "true"
      ? undefined
      : ["./test/globalSetup.ts"],
    globalTeardown: process.env.SKIP_TESTCONTAINERS === "true"
      ? undefined
      : ["./test/globalTeardown.ts"],
    // Increase timeout for E2E tests with containers
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
