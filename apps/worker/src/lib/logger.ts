/**
 * Pino logger for worker with redaction
 * Follows MyInvois guidelines - no secrets/tokens logged
 */

import pino from "pino";
import { PINO_REDACT_CONFIG, clientIdFingerprint } from "@myinvois/core";

/**
 * Get log level from environment
 */
function getLogLevel(): string {
  return process.env.LOG_LEVEL?.toLowerCase() || "info";
}

/**
 * Create the root logger instance with redaction
 */
export const logger = pino({
  level: getLogLevel(),
  redact: PINO_REDACT_CONFIG,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: true,
});

/**
 * Context for log entries
 */
export interface LogContext {
  [key: string]: unknown;
}

/**
 * Create a child logger with bound context
 */
export function createLogger(baseContext: LogContext): pino.Logger {
  return logger.child(baseContext);
}

/**
 * Create safe log context for session operations
 */
export function createSessionLogContext(session: {
  sessionId: string;
  env: string;
  mode: string;
  clientId: string;
}): Record<string, string> {
  return {
    sessionId: session.sessionId,
    env: session.env,
    mode: session.mode,
    clientIdFingerprint: clientIdFingerprint(session.clientId),
  };
}

/**
 * Create safe log context for submission operations
 */
export function createSubmissionLogContext(submission: {
  trackingId: string;
  sessionId: string;
  submissionUid?: string | null;
}): Record<string, string | undefined> {
  return {
    trackingId: submission.trackingId,
    sessionId: submission.sessionId,
    submissionUid: submission.submissionUid ?? undefined,
  };
}

/**
 * Create safe log context for poll job
 */
export function createPollLogContext(job: {
  jobId: string;
  trackingId: string;
  pollCount: number;
}): Record<string, string | number> {
  return {
    jobId: job.jobId,
    trackingId: job.trackingId,
    pollCount: job.pollCount,
  };
}
