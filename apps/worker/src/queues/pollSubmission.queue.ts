/**
 * Poll Submission Queue
 *
 * BullMQ queue for polling submission status from MyInvois.
 */

import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnection } from "../lib/redis.js";

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
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: {
    type: "exponential",
    delay: 2000, // Start with 2s, then 4s, 8s, etc.
  },
  removeOnComplete: {
    count: 1000, // Keep last 1000 completed jobs
    age: 24 * 3600, // Keep for 24 hours
  },
  removeOnFail: {
    count: 5000, // Keep last 5000 failed jobs for debugging
    age: 7 * 24 * 3600, // Keep for 7 days
  },
};

let pollQueue: Queue<PollSubmissionJobData> | null = null;

/**
 * Get or create the poll submission queue
 */
export function getPollQueue(): Queue<PollSubmissionJobData> {
  if (!pollQueue) {
    pollQueue = new Queue<PollSubmissionJobData>(POLL_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return pollQueue;
}

/**
 * Close the poll queue
 */
export async function closePollQueue(): Promise<void> {
  if (pollQueue) {
    await pollQueue.close();
    pollQueue = null;
  }
}

/**
 * Calculate jitter delay for polling (3-5 seconds)
 */
export function calculatePollDelay(): number {
  // Random delay between 3000ms and 5000ms
  return 3000 + Math.floor(Math.random() * 2000);
}

/**
 * Enqueue a poll job
 *
 * @param trackingId - Submission tracking ID
 * @param delayMs - Delay in milliseconds before processing
 * @returns Job ID
 */
export async function enqueuePoll(
  trackingId: string,
  delayMs: number = calculatePollDelay()
): Promise<string> {
  const queue = getPollQueue();

  const job = await queue.add(
    "poll",
    { trackingId },
    {
      // Use trackingId as jobId for idempotency
      // This prevents duplicate poll jobs for the same submission
      jobId: trackingId,
      delay: delayMs,
    }
  );

  return job.id || trackingId;
}

/**
 * Enqueue immediate poll (for manual trigger)
 */
export async function enqueueImmediatePoll(trackingId: string): Promise<string> {
  return enqueuePoll(trackingId, 0);
}

/**
 * Get queue stats
 */
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getPollQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}
