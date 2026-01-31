/**
 * Poll Invoice Queue - Gateway side
 *
 * Provides functions to enqueue invoice poll jobs from the gateway.
 * The actual processing is done by the worker.
 */

import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { pollQueueLogger } from "../lib/appLogger.js";

export const POLL_INVOICE_QUEUE_NAME = "poll-invoice";

/**
 * Job data for poll invoice
 */
export interface PollInvoiceJobData {
  /** Invoice ID from database */
  invoiceId: string;
  /** MyInvois document UUID */
  myinvoisUuid: string;
  /** Company ID */
  companyId: string;
  /** Poll attempt number */
  attempt?: number;
}

/**
 * Default job options
 */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 20, // More attempts for longer polling
  backoff: {
    type: "exponential",
    delay: 5000, // Start with 5s, then 10s, 20s, etc.
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
let pollInvoiceQueue: Queue<PollInvoiceJobData> | null = null;

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
 * Get or create the poll invoice queue
 */
function getPollInvoiceQueue(): Queue<PollInvoiceJobData> {
  if (!pollInvoiceQueue) {
    pollInvoiceQueue = new Queue<PollInvoiceJobData>(POLL_INVOICE_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return pollInvoiceQueue;
}

/**
 * Calculate poll delay based on attempt number
 * - First 5 attempts: 10 seconds each
 * - Next 10 attempts: 30 seconds each
 * - After that: 60 seconds each
 */
export function calculateInvoicePollDelay(attempt: number = 0): number {
  if (attempt < 5) {
    return 10000; // 10 seconds
  } else if (attempt < 15) {
    return 30000; // 30 seconds
  } else {
    return 60000; // 60 seconds
  }
}

/**
 * Enqueue an invoice poll job
 *
 * @param data - Poll job data
 * @param delayMs - Delay in milliseconds before processing
 * @returns Job ID or null if enqueue failed
 */
export async function enqueueInvoicePoll(
  data: PollInvoiceJobData,
  delayMs?: number
): Promise<string | null> {
  try {
    const queue = getPollInvoiceQueue();
    const delay = delayMs ?? calculateInvoicePollDelay(data.attempt ?? 0);

    const job = await queue.add(
      "poll-invoice",
      data,
      {
        // Use invoiceId as jobId for idempotency
        jobId: `invoice-${data.invoiceId}-${Date.now()}`,
        delay,
      }
    );

    return job.id || data.invoiceId;
  } catch (error) {
    // P2-01: Use structured logger instead of console.error
    pollQueueLogger.error({ error }, "Failed to enqueue invoice poll job");
    return null;
  }
}

/**
 * Enqueue immediate invoice poll (for manual trigger)
 */
export async function enqueueImmediateInvoicePoll(
  data: PollInvoiceJobData
): Promise<string | null> {
  return enqueueInvoicePoll(data, 0);
}

/**
 * Close queue connections (for cleanup)
 */
export async function closePollInvoiceQueue(): Promise<void> {
  if (pollInvoiceQueue) {
    await pollInvoiceQueue.close();
    pollInvoiceQueue = null;
  }
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}
