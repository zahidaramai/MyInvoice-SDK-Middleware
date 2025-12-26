/**
 * Poll Submission Worker
 *
 * Processes poll jobs for submissions, fetching status from MyInvois
 * and updating the local database.
 */

import { Worker, type Job } from "bullmq";
import type pino from "pino";
import { getRedisConnection } from "../lib/redis.js";
import { createLogger } from "../lib/logger.js";
import {
  recordPollJobResult,
  incSubmissionsInProgress,
  decSubmissionsInProgress,
} from "../lib/metrics.js";
import {
  POLL_QUEUE_NAME,
  type PollSubmissionJobData,
  enqueuePoll,
  calculatePollDelay,
} from "../queues/pollSubmission.queue.js";
import {
  getByTrackingIdWithPolling,
  updatePollState,
  finalizeSubmission,
  updateDocumentFromPoll,
  clearPollErrors,
} from "@myinvois/storage";
import {
  getSubmission,
  isTerminalStatus,
  TokenManager,
  type SessionCredentials,
  type NormalizedDocumentSummary,
} from "@myinvois/myinvois-client";
import type { Environment, Mode } from "@myinvois/core";

const MIN_POLL_INTERVAL_MS = 3000; // 3 seconds minimum between polls

// Token managers per session (simple in-memory cache)
const tokenManagers = new Map<string, TokenManager>();

/**
 * Get or create a token manager for a session
 */
function getTokenManager(sessionId: string): TokenManager {
  let manager = tokenManagers.get(sessionId);
  if (!manager) {
    manager = new TokenManager();
    tokenManagers.set(sessionId, manager);
  }
  return manager;
}

/**
 * Process a poll submission job
 */
async function processPollJob(job: Job<PollSubmissionJobData>): Promise<void> {
  const { trackingId } = job.data;
  const log = createLogger({ trackingId, jobId: job.id });

  log.info({ trackingId, jobId: job.id }, "Processing poll job");
  incSubmissionsInProgress();

  try {
    // Load submission from database
    const submission = await getByTrackingIdWithPolling(trackingId);
    if (!submission) {
      log.warn({ trackingId }, "Submission not found, skipping");
      recordPollJobResult("error");
      return;
    }

    // Check if already finalized
    if (submission.finalizedAt) {
      log.info({ status: submission.upstreamOverallStatus }, "Submission already finalized");
      recordPollJobResult("finalized");
      return;
    }

    // Check if we have upstream submission UID
    if (!submission.upstreamSubmissionUid) {
      log.warn("No upstream submission UID, cannot poll");
      recordPollJobResult("error");
      return;
    }

    // Check minimum poll interval
    const now = new Date();
    if (submission.lastPolledAt) {
      const elapsed = now.getTime() - submission.lastPolledAt.getTime();
      if (elapsed < MIN_POLL_INTERVAL_MS) {
        const delay = MIN_POLL_INTERVAL_MS - elapsed;
        log.debug({ delay }, "Too soon to poll, rescheduling");
        await enqueuePoll(trackingId, delay);
        recordPollJobResult("retry");
        return;
      }
    }

    // Build session credentials from stored data
    // Note: In production, you'd need to fetch client credentials from secure storage
    const session = buildSessionFromSubmission(submission.sessionId, submission.env);
    if (!session) {
      log.error("Cannot build session credentials");
      await updatePollState({
        trackingId,
        lastPolledAt: now,
        nextPollAt: null,
        pollAttempts: submission.pollAttempts + 1,
        lastPollErrorCode: "SESSION_ERROR",
        lastPollErrorMessage: "Cannot build session credentials",
      });
      recordPollJobResult("error");
      return;
    }

    const tokenManager = getTokenManager(submission.sessionId);

    log.info({ submissionUid: submission.upstreamSubmissionUid }, "Calling MyInvois Get Submission");

    // Call MyInvois API
    const result = await getSubmission(
      session,
      {
        submissionUid: submission.upstreamSubmissionUid,
        pageNo: 1,
        pageSize: 100,
      },
      { tokenManager }
    );

    if (!result.ok) {
      await handlePollError(trackingId, submission.pollAttempts, result.error, log);
      return;
    }

    // Success - update submission status
    const { overallStatus, documentSummary, meta } = result.result;

    log.info({
      submissionUid: submission.upstreamSubmissionUid,
      overallStatus,
      documentCount: documentSummary.length,
      correlationId: meta.correlationId,
    }, "Poll successful");

    // Clear any previous poll errors
    await clearPollErrors(trackingId);

    // Check if terminal status
    if (isTerminalStatus(overallStatus)) {
      log.info({ overallStatus }, "Submission finalized");

      await finalizeSubmission({
        trackingId,
        upstreamOverallStatus: overallStatus,
        finalizedAt: now,
        lastUpstreamCorrelationId: meta.correlationId,
      });

      // Update document summaries
      await updateDocumentSummaries(trackingId, documentSummary);
      recordPollJobResult("finalized");
    } else {
      // Still in progress - schedule next poll
      const nextPollAt = new Date(now.getTime() + calculatePollDelay());

      await updatePollState({
        trackingId,
        lastPolledAt: now,
        nextPollAt,
        pollAttempts: submission.pollAttempts + 1,
        upstreamOverallStatus: overallStatus,
        lastUpstreamCorrelationId: meta.correlationId,
      });

      // Update document summaries
      await updateDocumentSummaries(trackingId, documentSummary);

      // Enqueue next poll
      const delay = nextPollAt.getTime() - Date.now();
      log.debug({ delay }, "Scheduling next poll");
      await enqueuePoll(trackingId, delay);
      recordPollJobResult("success");
    }
  } finally {
    decSubmissionsInProgress();
  }
}

/**
 * Handle poll error
 */
async function handlePollError(
  trackingId: string,
  pollAttempts: number,
  error: { status: number; message: string; code?: string; meta?: { rateLimitReset?: number } },
  log: pino.Logger
): Promise<void> {
  const now = new Date();

  log.warn({
    status: error.status,
    code: error.code,
    message: error.message,
  }, "Poll failed");

  // Handle rate limiting (429)
  if (error.status === 429) {
    const retryAfterSeconds = error.meta?.rateLimitReset
      ? error.meta.rateLimitReset - Math.floor(Date.now() / 1000)
      : 60;
    const nextPollAt = new Date(now.getTime() + retryAfterSeconds * 1000);

    log.info({ retryAfterSeconds }, "Rate limited, rescheduling");

    await updatePollState({
      trackingId,
      lastPolledAt: now,
      nextPollAt,
      pollAttempts: pollAttempts + 1,
      lastPollErrorCode: error.code || "RATE_LIMITED",
      lastPollErrorMessage: error.message,
    });

    await enqueuePoll(trackingId, retryAfterSeconds * 1000);
    recordPollJobResult("rate_limited");
    return;
  }

  // Handle 404 (submission not found upstream)
  if (error.status === 404) {
    log.error("Submission not found upstream, stopping polling");
    await updatePollState({
      trackingId,
      lastPolledAt: now,
      nextPollAt: null,
      pollAttempts: pollAttempts + 1,
      lastPollErrorCode: error.code || "NOT_FOUND",
      lastPollErrorMessage: error.message,
    });
    recordPollJobResult("error");
    return;
  }

  // For other errors, let BullMQ handle retries with exponential backoff
  // by throwing the error
  await updatePollState({
    trackingId,
    lastPolledAt: now,
    nextPollAt: null, // Will be set by next job
    pollAttempts: pollAttempts + 1,
    lastPollErrorCode: error.code || "POLL_ERROR",
    lastPollErrorMessage: error.message,
  });

  recordPollJobResult("error");
  throw new Error(`Poll failed: ${error.code || error.status} - ${error.message}`);
}

/**
 * Update document summaries from poll response
 */
async function updateDocumentSummaries(
  trackingId: string,
  summaries: NormalizedDocumentSummary[]
): Promise<void> {
  for (const doc of summaries) {
    await updateDocumentFromPoll({
      submissionTrackingId: trackingId,
      upstreamUuid: doc.uuid,
      upstreamStatus: doc.status,
      longId: doc.longId ?? undefined,
      dateTimeValidated: doc.dateTimeValidated ?? undefined,
      issuerTin: doc.issuerTin,
      issuerName: doc.issuerName ?? undefined,
      receiverId: doc.receiverId ?? undefined,
      receiverName: doc.receiverName ?? undefined,
      totalPayableAmount: doc.totalPayableAmount ?? undefined,
    });
  }
}

/**
 * Build session credentials from stored session ID
 *
 * Note: In production, you would need to:
 * 1. Store encrypted client credentials in the sessions table
 * 2. Decrypt and build the session here
 *
 * For now, this uses environment variables as a fallback.
 */
function buildSessionFromSubmission(
  sessionId: string,
  env: string
): SessionCredentials | null {
  // In production, fetch from secure storage using sessionId
  // For now, use environment variables
  const clientId = process.env.MYINVOIS_CLIENT_ID;
  const clientSecret = process.env.MYINVOIS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    sessionId,
    env: env as Environment,
    mode: "TAXPAYER" as Mode,
    clientId,
    clientSecret,
  };
}

let pollWorker: Worker<PollSubmissionJobData> | null = null;

/**
 * Start the poll submission worker
 */
export function startPollWorker(): Worker<PollSubmissionJobData> {
  if (pollWorker) {
    return pollWorker;
  }

  pollWorker = new Worker<PollSubmissionJobData>(
    POLL_QUEUE_NAME,
    processPollJob,
    {
      connection: getRedisConnection(),
      concurrency: 10, // Process up to 10 jobs concurrently
      // BullMQ doesn't have built-in per-key rate limiting
      // Rate limiting is handled at the API client level
    }
  );

  pollWorker.on("completed", (job) => {
    createLogger({ trackingId: job.data.trackingId, jobId: job.id }).debug(
      "Job completed"
    );
  });

  pollWorker.on("failed", (job, err) => {
    if (job) {
      createLogger({ trackingId: job.data.trackingId, jobId: job.id }).error(
        { error: err.message },
        "Job failed"
      );
    }
  });

  pollWorker.on("error", (err) => {
    createLogger({}).error({ error: err.message }, "Worker error");
  });

  return pollWorker;
}

/**
 * Stop the poll submission worker
 */
export async function stopPollWorker(): Promise<void> {
  if (pollWorker) {
    await pollWorker.close();
    pollWorker = null;
  }
}

/**
 * Get current worker instance
 */
export function getPollWorker(): Worker<PollSubmissionJobData> | null {
  return pollWorker;
}
