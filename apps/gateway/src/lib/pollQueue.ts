/**
 * Poll Queue - Gateway side
 *
 * Provides functions to enqueue poll jobs from the gateway.
 * The actual processing is done by the worker.
 */

import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { pollQueueLogger } from "./appLogger.js";

export const POLL_QUEUE_NAME = "poll-submission";

/**
 * Job data for poll submission
 */
export interface PollSubmissionJobData {
  /** Gateway tracking ID */
  trackingId: string;
}

/**
 * Default job options
 */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: {
    type: "exponential",
    delay: 2000,
  },
  removeOnComplete: {
    count: 1000,
    age: 24 * 3600,
  },
  removeOnFail: {
    count: 5000,
    age: 7 * 24 * 3600,
  },
};

let redisConnection: Redis | null = null;
let pollQueue: Queue<PollSubmissionJobData> | null = null;

/**
 * Get Redis URL from environment
 */
function getRedisUrl(): string {
  return process.env.REDIS_URL || "redis://localhost:6379";
}

/**
 * Get or create Redis connection
 */
function getRedisConnection(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return redisConnection;
}

/**
 * Get or create the poll submission queue
 */
function getPollQueue(): Queue<PollSubmissionJobData> {
  if (!pollQueue) {
    pollQueue = new Queue<PollSubmissionJobData>(POLL_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return pollQueue;
}

/**
 * Calculate jitter delay for polling (3-5 seconds)
 */
export function calculatePollDelay(): number {
  return 3000 + Math.floor(Math.random() * 2000);
}

/**
 * Minimum poll interval in milliseconds
 */
export const MIN_POLL_INTERVAL_MS = 3000;

/**
 * Enqueue a poll job
 *
 * @param trackingId - Submission tracking ID
 * @param delayMs - Delay in milliseconds before processing
 * @returns Job ID or null if enqueue failed
 */
export async function enqueuePoll(
  trackingId: string,
  delayMs: number = calculatePollDelay()
): Promise<string | null> {
  try {
    const queue = getPollQueue();
    const job = await queue.add(
      "poll",
      { trackingId },
      {
        jobId: trackingId,
        delay: delayMs,
      }
    );
    return job.id || trackingId;
  } catch (error) {
    // P2-01: Use structured logger instead of console.error
    pollQueueLogger.error({ error }, "Failed to enqueue poll job");
    return null;
  }
}

/**
 * Enqueue immediate poll (for manual trigger via POST /poll)
 */
export async function enqueueImmediatePoll(trackingId: string): Promise<string | null> {
  return enqueuePoll(trackingId, 0);
}

/**
 * Close queue connections (for cleanup)
 */
export async function closePollQueue(): Promise<void> {
  if (pollQueue) {
    await pollQueue.close();
    pollQueue = null;
  }
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}

/**
 * Check if Redis is available
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
