/**
 * Test Environment Helpers
 *
 * Provides utilities for accessing test infrastructure.
 */

import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the test database URL
 */
export function getTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set. Ensure Testcontainers is running via global setup."
    );
  }
  return url;
}

/**
 * Get the test Redis URL
 */
export function getTestRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL not set. Ensure Testcontainers is running via global setup."
    );
  }
  return url;
}

/**
 * Reset the test database (clears all data)
 */
export async function resetTestDatabase(): Promise<void> {
  const storageDir = resolve(__dirname, "../packages/storage");
  const databaseUrl = getTestDatabaseUrl();

  execSync(`pnpm prisma db push --force-reset --skip-generate`, {
    cwd: storageDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: "pipe",
  });
}

/**
 * Check if running in E2E mode (with Testcontainers)
 */
export function isE2EMode(): boolean {
  return process.env.SKIP_TESTCONTAINERS !== "true";
}
