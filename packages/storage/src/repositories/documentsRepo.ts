/**
 * Documents repository - handles document action persistence
 */

import { getPrismaClient } from "../prisma.js";
import type {
  RecordDocumentActionInput,
  RecordDocumentActionErrorInput,
  RecordDocumentDetailsInput,
  DocumentRecordWithActions,
} from "../types.js";

/**
 * Get document by UUID
 */
export async function getDocumentByUuid(uuid: string): Promise<DocumentRecordWithActions | null> {
  const prisma = getPrismaClient();

  const doc = await prisma.submissionDocument.findFirst({
    where: { upstreamUuid: uuid },
  });

  return doc as DocumentRecordWithActions | null;
}

/**
 * Record successful document action (cancel/reject)
 */
export async function recordDocumentAction(
  input: RecordDocumentActionInput
): Promise<DocumentRecordWithActions | null> {
  const prisma = getPrismaClient();
  const now = new Date();

  // Find the document first
  const existing = await prisma.submissionDocument.findFirst({
    where: { upstreamUuid: input.uuid },
  });

  if (!existing) {
    return null;
  }

  // Update with action result
  const updated = await prisma.submissionDocument.update({
    where: { id: existing.id },
    data: {
      lastActionType: input.actionType,
      lastActionReason: input.reason,
      lastActionAt: now,
      lastActionStatus: input.upstreamStatus,
      lastActionCorrelationId: input.correlationId,
      // Clear any previous error
      lastActionErrorCode: null,
      lastActionErrorMessage: null,
      // Update upstream status to match action result
      upstreamStatus: input.upstreamStatus,
      // Set cancel/reject datetime if applicable
      ...(input.actionType === "CANCEL" && { cancelDateTime: now }),
      ...(input.actionType === "REJECT" && { rejectDateTime: now }),
    },
  });

  return updated as DocumentRecordWithActions;
}

/**
 * Record document action error
 */
export async function recordDocumentActionError(
  input: RecordDocumentActionErrorInput
): Promise<DocumentRecordWithActions | null> {
  const prisma = getPrismaClient();
  const now = new Date();

  // Find the document first
  const existing = await prisma.submissionDocument.findFirst({
    where: { upstreamUuid: input.uuid },
  });

  if (!existing) {
    return null;
  }

  // Update with error
  const updated = await prisma.submissionDocument.update({
    where: { id: existing.id },
    data: {
      lastActionType: input.actionType,
      lastActionReason: input.reason,
      lastActionAt: now,
      lastActionErrorCode: input.errorCode,
      lastActionErrorMessage: input.errorMessage,
    },
  });

  return updated as DocumentRecordWithActions;
}

/**
 * Record document details snapshot from getDocumentDetails call
 */
export async function recordDocumentDetails(
  input: RecordDocumentDetailsInput
): Promise<DocumentRecordWithActions | null> {
  const prisma = getPrismaClient();

  // Find the document first
  const existing = await prisma.submissionDocument.findFirst({
    where: { upstreamUuid: input.uuid },
  });

  if (!existing) {
    return null;
  }

  // Update with details snapshot
  const updated = await prisma.submissionDocument.update({
    where: { id: existing.id },
    data: {
      upstreamStatus: input.status,
      ...(input.longId && { longId: input.longId }),
      ...(input.dateTimeValidated && { dateTimeValidated: input.dateTimeValidated }),
      ...(input.dateTimeIssued && { dateTimeIssued: input.dateTimeIssued }),
      ...(input.dateTimeReceived && { dateTimeReceived: input.dateTimeReceived }),
      ...(input.cancelDateTime && { cancelDateTime: input.cancelDateTime }),
      ...(input.rejectDateTime && { rejectDateTime: input.rejectDateTime }),
      ...(input.issuerTin && { issuerTin: input.issuerTin }),
      ...(input.issuerName && { issuerName: input.issuerName }),
      ...(input.receiverId && { receiverId: input.receiverId }),
      ...(input.receiverName && { receiverName: input.receiverName }),
      ...(input.totalPayableAmount && { totalPayableAmount: input.totalPayableAmount }),
      ...(input.statusReason && { statusReason: input.statusReason }),
      ...(input.correlationId && { lastActionCorrelationId: input.correlationId }),
    },
  });

  return updated as DocumentRecordWithActions;
}

/**
 * Get document with full action fields by UUID
 */
export async function getDocumentWithActions(
  uuid: string
): Promise<DocumentRecordWithActions | null> {
  const prisma = getPrismaClient();

  const doc = await prisma.submissionDocument.findFirst({
    where: { upstreamUuid: uuid },
  });

  return doc as DocumentRecordWithActions | null;
}

/**
 * Check if document exists by UUID
 */
export async function documentExistsByUuid(uuid: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const count = await prisma.submissionDocument.count({
    where: { upstreamUuid: uuid },
  });

  return count > 0;
}
