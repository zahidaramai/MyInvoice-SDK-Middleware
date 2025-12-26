/**
 * MyInvois Worker - Background Job Processor
 *
 * Processes polling jobs for submissions using BullMQ.
 */

import { getPrismaClient, disconnectPrisma } from "@myinvois/storage";
import { logger } from "./lib/logger.js";
import {
  initMetrics,
  startMetricsServer,
  stopMetricsServer,
} from "./lib/metrics.js";
import { closeRedisConnection, isRedisConnected } from "./lib/redis.js";
import { closePollQueue, getQueueStats } from "./queues/pollSubmission.queue.js";
import { startPollWorker, stopPollWorker } from "./workers/pollSubmission.worker.js";

export const WORKER_NAME = "@myinvois/worker";
export const WORKER_VERSION = "0.1.0";

/**
 * Worker configuration from environment
 */
function loadConfig() {
  return {
    metricsEnabled: process.env.METRICS_ENABLED === "true",
    metricsPort: parseInt(process.env.METRICS_PORT || "9091", 10),
  };
}

export function getWorkerName(): string {
  return WORKER_NAME;
}

export function getWorkerVersion(): string {
  return WORKER_VERSION;
}

let isShuttingDown = false;

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info({ signal }, "Received signal, shutting down gracefully...");

  try {
    // Stop the worker first (finishes current jobs)
    await stopPollWorker();
    logger.info("Poll worker stopped");

    // Close the queue
    await closePollQueue();
    logger.info("Poll queue closed");

    // Stop metrics server
    await stopMetricsServer();

    // Close database connection
    await disconnectPrisma();
    logger.info("Database connection closed");

    // Close Redis connection
    await closeRedisConnection();
    logger.info("Redis connection closed");

    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : "Unknown error" }, "Error during shutdown");
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const config = loadConfig();

  logger.info({ name: WORKER_NAME, version: WORKER_VERSION }, "Starting worker");

  // Initialize metrics (always initialize, server is optional)
  initMetrics();
  logger.info("Metrics initialized");

  // Start metrics server if enabled
  if (config.metricsEnabled) {
    await startMetricsServer(config.metricsPort);
  }

  // Initialize database
  try {
    getPrismaClient();
    logger.info("Database initialized");
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : "Unknown error" }, "Failed to initialize database");
    process.exit(1);
  }

  // Check Redis connection
  const redisConnected = await isRedisConnected();
  if (!redisConnected) {
    logger.error("Failed to connect to Redis");
    process.exit(1);
  }
  logger.info("Redis connected");

  // Start the poll worker
  const worker = startPollWorker();
  logger.info({ concurrency: 10 }, "Poll worker started");

  // Log initial queue stats
  const stats = await getQueueStats();
  logger.info(stats, "Queue stats");

  // Register shutdown handlers
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Keep the process running
  logger.info("Worker is running. Press Ctrl+C to stop.");

  // Log stats periodically
  setInterval(async () => {
    if (!isShuttingDown) {
      const stats = await getQueueStats();
      logger.debug(stats, "Queue stats");
    }
  }, 60000); // Every minute

  // Wait for worker to be ready
  await worker.waitUntilReady();
  logger.info("Worker is ready to process jobs");
}

// Export queue functions for gateway to use
export { enqueuePoll, enqueueImmediatePoll, getQueueStats } from "./queues/pollSubmission.queue.js";
export { calculatePollDelay } from "./queues/pollSubmission.queue.js";

// Run main if this is the entry point
main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : "Unknown error" }, "Fatal error");
  process.exit(1);
});
