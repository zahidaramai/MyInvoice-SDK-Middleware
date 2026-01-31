/**
 * Monthly Consolidate Queue
 *
 * BullMQ queue for automatically consolidating and submitting DRAFT invoices
 * on the 28th of every month at 2:00 AM Malaysia time.
 */

import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnection } from "../lib/redis.js";

export const MONTHLY_CONSOLIDATE_QUEUE_NAME = "monthly-consolidate";

/**
 * Job data for monthly consolidation
 */
export interface MonthlyConsolidateJobData {
  /** ISO timestamp when the job was triggered */
  triggeredAt: string;
  /** Whether this was triggered manually via API */
  manual?: boolean;
  /** Optional: specific company ID to process (if not provided, processes all) */
  companyId?: string;
}

/**
 * Default job options for monthly consolidation
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 60000, // Start with 1 minute, then 2 min, 4 min
  },
  removeOnComplete: {
    count: 100, // Keep last 100 completed jobs
    age: 30 * 24 * 3600, // Keep for 30 days
  },
  removeOnFail: {
    count: 500, // Keep last 500 failed jobs for debugging
    age: 90 * 24 * 3600, // Keep for 90 days
  },
};

let monthlyConsolidateQueue: Queue<MonthlyConsolidateJobData> | null = null;

/**
 * Get or create the monthly consolidation queue
 */
export function getMonthlyConsolidateQueue(): Queue<MonthlyConsolidateJobData> {
  if (!monthlyConsolidateQueue) {
    monthlyConsolidateQueue = new Queue<MonthlyConsolidateJobData>(
      MONTHLY_CONSOLIDATE_QUEUE_NAME,
      {
        connection: getRedisConnection(),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }
    );
  }
  return monthlyConsolidateQueue;
}

/**
 * Close the monthly consolidation queue
 */
export async function closeMonthlyConsolidateQueue(): Promise<void> {
  if (monthlyConsolidateQueue) {
    await monthlyConsolidateQueue.close();
    monthlyConsolidateQueue = null;
  }
}

/**
 * Initialize the repeating cron job
 * Schedule: 0 2 28 * * = 2:00 AM on 28th of every month (Malaysia time)
 */
export async function initMonthlyConsolidateCron(): Promise<void> {
  const queue = getMonthlyConsolidateQueue();

  // Remove any existing repeatable jobs to avoid duplicates on restart
  const existingJobs = await queue.getRepeatableJobs();
  for (const job of existingJobs) {
    if (job.name === "monthly-consolidate-cron") {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // Add new repeatable job
  // Cron: 0 2 28 * * = At 02:00 on day-of-month 28
  await queue.add(
    "monthly-consolidate-cron",
    { triggeredAt: new Date().toISOString(), manual: false },
    {
      repeat: {
        pattern: "0 2 28 * *",
        tz: "Asia/Kuala_Lumpur",
      },
      jobId: "monthly-consolidate-cron",
    }
  );
}

/**
 * Manually trigger consolidation (for admin/testing)
 * @param companyId Optional company ID to process only that company
 */
export async function triggerManualConsolidation(
  companyId?: string
): Promise<{ jobId: string }> {
  const queue = getMonthlyConsolidateQueue();

  const job = await queue.add(
    "monthly-consolidate-manual",
    {
      triggeredAt: new Date().toISOString(),
      manual: true,
      companyId,
    },
    {
      jobId: `manual-${Date.now()}`,
    }
  );

  return { jobId: job.id || `manual-${Date.now()}` };
}

/**
 * Get queue stats
 */
export async function getMonthlyConsolidateQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getMonthlyConsolidateQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}
