/**
 * Submissions repository - handles persistence of submissions and documents
 */

import { getPrismaClient } from "../prisma.js";
import type {
  CreateSubmissionInput,
  UpdateSubmissionWithUpstreamInput,
  MarkSubmissionErrorInput,
  SubmissionWithDocuments,
  IdempotencyRecord,
  SchedulePollInput,
  UpdatePollStateInput,
  FinalizeSubmissionInput,
  UpdateDocumentFromPollInput,
  SubmissionWithDocumentsAndPolling,
} from "../types.js";

const IDEMPOTENCY_WINDOW_MINUTES = 10;

/**
 * Create a new submission with documents
 */
export async function createSubmission(
  input: CreateSubmissionInput
): Promise<SubmissionWithDocuments> {
  const prisma = getPrismaClient();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_WINDOW_MINUTES * 60 * 1000);

  const submission = await prisma.submission.create({
    data: {
      trackingId: input.trackingId,
      sessionId: input.sessionId,
      env: input.env,
      payloadHash: input.payloadHash,
      status: "RECEIVED",
      documents: {
        create: input.documents.map((doc) => ({
          codeNumber: doc.codeNumber,
        })),
      },
      idempotencyWindow: {
        create: {
          sessionId: input.sessionId,
          payloadHash: input.payloadHash,
          expiresAt,
        },
      },
    },
    include: {
      documents: true,
    },
  });

  return submission;
}

/**
 * Find a recent submission by payload hash within the idempotency window
 */
export async function findRecentByPayloadHash(
  sessionId: string,
  payloadHash: string,
  withinMinutes: number = IDEMPOTENCY_WINDOW_MINUTES
): Promise<SubmissionWithDocuments | null> {
  const prisma = getPrismaClient();
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000);

  // Find the idempotency window entry first
  const window = await prisma.idempotencyWindow.findFirst({
    where: {
      sessionId,
      payloadHash,
      expiresAt: { gt: new Date() },
      createdAt: { gte: cutoff },
    },
    include: {
      submission: {
        include: {
          documents: true,
        },
      },
    },
  });

  return window?.submission ?? null;
}

/**
 * Update submission with upstream result (after successful 202 from MyInvois)
 */
export async function updateWithUpstreamResult(
  input: UpdateSubmissionWithUpstreamInput
): Promise<SubmissionWithDocuments> {
  const prisma = getPrismaClient();

  // Update the submission
  await prisma.submission.update({
    where: { trackingId: input.trackingId },
    data: {
      upstreamSubmissionUid: input.upstreamSubmissionUid,
      correlationId: input.correlationId,
      status: "SUBMITTED",
    },
  });

  // Update accepted documents
  for (const doc of input.acceptedDocuments) {
    await prisma.submissionDocument.updateMany({
      where: {
        submissionTrackingId: input.trackingId,
        codeNumber: doc.codeNumber,
      },
      data: {
        upstreamUuid: doc.uuid,
        initialResult: "ACCEPTED",
      },
    });
  }

  // Update rejected documents
  for (const doc of input.rejectedDocuments) {
    await prisma.submissionDocument.updateMany({
      where: {
        submissionTrackingId: input.trackingId,
        codeNumber: doc.codeNumber,
      },
      data: {
        initialResult: "REJECTED",
        errorCode: doc.errorCode,
        errorMessage: doc.errorMessage,
      },
    });
  }

  // Fetch updated submission with documents
  const updated = await prisma.submission.findUnique({
    where: { trackingId: input.trackingId },
    include: { documents: true },
  });

  return updated!;
}

/**
 * Mark submission as duplicate suppressed
 */
export async function markDuplicateSuppressed(
  trackingId: string
): Promise<SubmissionWithDocuments> {
  const prisma = getPrismaClient();

  const submission = await prisma.submission.update({
    where: { trackingId },
    data: {
      status: "DUPLICATE_SUPPRESSED",
    },
    include: {
      documents: true,
    },
  });

  return submission;
}

/**
 * Mark submission as error
 */
export async function markSubmissionError(
  input: MarkSubmissionErrorInput
): Promise<SubmissionWithDocuments> {
  const prisma = getPrismaClient();

  const submission = await prisma.submission.update({
    where: { trackingId: input.trackingId },
    data: {
      status: "ERROR",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      correlationId: input.correlationId,
      retryAfterSeconds: input.retryAfterSeconds,
    },
    include: {
      documents: true,
    },
  });

  return submission;
}

/**
 * Get submission by tracking ID
 */
export async function getByTrackingId(
  trackingId: string
): Promise<SubmissionWithDocuments | null> {
  const prisma = getPrismaClient();

  const submission = await prisma.submission.findUnique({
    where: { trackingId },
    include: { documents: true },
  });

  return submission;
}

/**
 * Get submission by upstream submission UID
 */
export async function getByUpstreamUid(
  upstreamSubmissionUid: string
): Promise<SubmissionWithDocuments | null> {
  const prisma = getPrismaClient();

  const submission = await prisma.submission.findFirst({
    where: { upstreamSubmissionUid },
    include: { documents: true },
  });

  return submission;
}

/**
 * Update submission upstream overall status (for polling)
 */
export async function updateUpstreamStatus(
  trackingId: string,
  upstreamOverallStatus: string,
  correlationId?: string
): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.submission.update({
    where: { trackingId },
    data: {
      upstreamOverallStatus,
      ...(correlationId && { correlationId }),
    },
  });
}

/**
 * Clean up expired idempotency windows
 */
export async function cleanupExpiredWindows(): Promise<number> {
  const prisma = getPrismaClient();

  const result = await prisma.idempotencyWindow.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  return result.count;
}

/**
 * Get idempotency window by session and payload hash
 */
export async function getIdempotencyWindow(
  sessionId: string,
  payloadHash: string
): Promise<IdempotencyRecord | null> {
  const prisma = getPrismaClient();

  const window = await prisma.idempotencyWindow.findUnique({
    where: {
      sessionId_payloadHash: {
        sessionId,
        payloadHash,
      },
    },
  });

  return window;
}

// === Phase 05: Polling methods ===

/**
 * Schedule the first poll for a submission
 */
export async function schedulePoll(input: SchedulePollInput): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.submission.update({
    where: { trackingId: input.trackingId },
    data: {
      nextPollAt: input.nextPollAt,
      pollAttempts: 0,
    },
  });
}

/**
 * Find submissions that are due for polling
 * Returns submissions where:
 * - status is SUBMITTED
 * - nextPollAt is in the past or now
 * - finalizedAt is null (not yet terminal)
 */
export async function findSubmissionsDueForPoll(
  limit: number = 100
): Promise<SubmissionWithDocumentsAndPolling[]> {
  const prisma = getPrismaClient();
  const now = new Date();

  const submissions = await prisma.submission.findMany({
    where: {
      status: "SUBMITTED",
      nextPollAt: { lte: now },
      finalizedAt: null,
    },
    include: { documents: true },
    orderBy: { nextPollAt: "asc" },
    take: limit,
  });

  return submissions as SubmissionWithDocumentsAndPolling[];
}

/**
 * Update polling state after a poll attempt
 */
export async function updatePollState(input: UpdatePollStateInput): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.submission.update({
    where: { trackingId: input.trackingId },
    data: {
      lastPolledAt: input.lastPolledAt,
      nextPollAt: input.nextPollAt,
      pollAttempts: input.pollAttempts,
      ...(input.upstreamOverallStatus && {
        upstreamOverallStatus: input.upstreamOverallStatus,
      }),
      ...(input.lastUpstreamCorrelationId && {
        lastUpstreamCorrelationId: input.lastUpstreamCorrelationId,
      }),
      ...(input.lastPollErrorCode && {
        lastPollErrorCode: input.lastPollErrorCode,
      }),
      ...(input.lastPollErrorMessage && {
        lastPollErrorMessage: input.lastPollErrorMessage,
      }),
    },
  });
}

/**
 * Clear poll error state (on successful poll)
 */
export async function clearPollErrors(trackingId: string): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.submission.update({
    where: { trackingId },
    data: {
      lastPollErrorCode: null,
      lastPollErrorMessage: null,
    },
  });
}

/**
 * Finalize a submission when it reaches a terminal status
 */
export async function finalizeSubmission(
  input: FinalizeSubmissionInput
): Promise<SubmissionWithDocumentsAndPolling> {
  const prisma = getPrismaClient();

  const submission = await prisma.submission.update({
    where: { trackingId: input.trackingId },
    data: {
      upstreamOverallStatus: input.upstreamOverallStatus,
      finalizedAt: input.finalizedAt,
      nextPollAt: null, // Stop polling
      lastPolledAt: input.finalizedAt,
      ...(input.lastUpstreamCorrelationId && {
        lastUpstreamCorrelationId: input.lastUpstreamCorrelationId,
      }),
    },
    include: { documents: true },
  });

  return submission as SubmissionWithDocumentsAndPolling;
}

/**
 * Update a document with data from poll response
 */
export async function updateDocumentFromPoll(
  input: UpdateDocumentFromPollInput
): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.submissionDocument.updateMany({
    where: {
      submissionTrackingId: input.submissionTrackingId,
      upstreamUuid: input.upstreamUuid,
    },
    data: {
      upstreamStatus: input.upstreamStatus,
      ...(input.longId && { longId: input.longId }),
      ...(input.dateTimeValidated && { dateTimeValidated: input.dateTimeValidated }),
      ...(input.issuerTin && { issuerTin: input.issuerTin }),
      ...(input.issuerName && { issuerName: input.issuerName }),
      ...(input.receiverId && { receiverId: input.receiverId }),
      ...(input.receiverName && { receiverName: input.receiverName }),
      ...(input.totalPayableAmount && { totalPayableAmount: input.totalPayableAmount }),
    },
  });
}

/**
 * Get submission with full polling fields by tracking ID
 */
export async function getByTrackingIdWithPolling(
  trackingId: string
): Promise<SubmissionWithDocumentsAndPolling | null> {
  const prisma = getPrismaClient();

  const submission = await prisma.submission.findUnique({
    where: { trackingId },
    include: { documents: true },
  });

  return submission as SubmissionWithDocumentsAndPolling | null;
}

/**
 * Get submission with full polling fields by upstream UID
 */
export async function getByUpstreamUidWithPolling(
  upstreamSubmissionUid: string
): Promise<SubmissionWithDocumentsAndPolling | null> {
  const prisma = getPrismaClient();

  const submission = await prisma.submission.findFirst({
    where: { upstreamSubmissionUid },
    include: { documents: true },
  });

  return submission as SubmissionWithDocumentsAndPolling | null;
}

/**
 * Count submissions that are currently pending poll
 */
export async function countPendingPolls(): Promise<number> {
  const prisma = getPrismaClient();

  const count = await prisma.submission.count({
    where: {
      status: "SUBMITTED",
      nextPollAt: { not: null },
      finalizedAt: null,
    },
  });

  return count;
}
