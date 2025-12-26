/**
 * Vitest Global Setup - Testcontainers
 *
 * Starts PostgreSQL and Redis containers for E2E tests.
 * Containers are shared across all test files for performance.
 */

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Store container references for teardown
let postgresContainer: Awaited<ReturnType<PostgreSqlContainer["start"]>> | null = null;
let redisContainer: Awaited<ReturnType<RedisContainer["start"]>> | null = null;

export async function setup(): Promise<void> {
  // Skip testcontainers in unit test mode
  if (process.env.SKIP_TESTCONTAINERS === "true") {
    console.log("[GlobalSetup] Skipping Testcontainers (unit test mode)");
    return;
  }

  console.log("[GlobalSetup] Starting PostgreSQL container...");
  postgresContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("myinvois_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const databaseUrl = postgresContainer.getConnectionUri();
  console.log(`[GlobalSetup] PostgreSQL started at ${databaseUrl}`);

  console.log("[GlobalSetup] Starting Redis container...");
  redisContainer = await new RedisContainer("redis:7-alpine").start();

  const redisUrl = redisContainer.getConnectionUrl();
  console.log(`[GlobalSetup] Redis started at ${redisUrl}`);

  // Set environment variables for tests
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NODE_ENV = "test";

  // Write env to a file for test processes
  const envFile = resolve(__dirname, ".env.test");
  writeFileSync(
    envFile,
    `DATABASE_URL=${databaseUrl}\nREDIS_URL=${redisUrl}\nNODE_ENV=test\n`
  );

  // Run Prisma migrations
  console.log("[GlobalSetup] Running Prisma migrations...");
  const storageDir = resolve(__dirname, "../packages/storage");

  try {
    execSync(`pnpm prisma db push --force-reset --skip-generate`, {
      cwd: storageDir,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: "pipe",
    });
    console.log("[GlobalSetup] Prisma migrations complete");
  } catch (error) {
    console.error("[GlobalSetup] Prisma migration failed:", error);
    throw error;
  }

  // Store container info in globalThis for teardown
  (globalThis as Record<string, unknown>).__POSTGRES_CONTAINER__ = postgresContainer;
  (globalThis as Record<string, unknown>).__REDIS_CONTAINER__ = redisContainer;
}

export async function teardown(): Promise<void> {
  if (process.env.SKIP_TESTCONTAINERS === "true") {
    return;
  }

  console.log("[GlobalTeardown] Stopping containers...");

  const pg = (globalThis as Record<string, unknown>).__POSTGRES_CONTAINER__ as typeof postgresContainer;
  const redis = (globalThis as Record<string, unknown>).__REDIS_CONTAINER__ as typeof redisContainer;

  if (pg) {
    await pg.stop();
    console.log("[GlobalTeardown] PostgreSQL stopped");
  }

  if (redis) {
    await redis.stop();
    console.log("[GlobalTeardown] Redis stopped");
  }
}

export default setup;
