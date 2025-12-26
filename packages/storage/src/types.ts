/**
 * Type definitions for storage layer
 */

/**
 * Submission status values
 */
export type SubmissionStatus =
  | "RECEIVED"
  | "SUBMITTED"
  | "DUPLICATE_SUPPRESSED"
  | "ERROR";

/**
 * Upstream overall status values
 */
export type UpstreamOverallStatus =
  | "IN_PROGRESS"
  | "VALID"
  | "PARTIALLY_VALID"
  | "INVALID";

/**
 * Document initial result values
 */
export type DocumentInitialResult = "ACCEPTED" | "REJECTED";

/**
 * Environment values
 */
export type StorageEnvironment = "PROD" | "SANDBOX";

/**
 * Input for creating a new submission
 */
export interface CreateSubmissionInput {
  trackingId: string;
  sessionId: string;
  env: StorageEnvironment;
  payloadHash: string;
  documents: Array<{
    codeNumber: string;
  }>;
}

/**
 * Input for updating submission with upstream result
 */
export interface UpdateSubmissionWithUpstreamInput {
  trackingId: string;
  upstreamSubmissionUid: string;
  correlationId?: string;
  acceptedDocuments: Array<{
    codeNumber: string;
    uuid: string;
  }>;
  rejectedDocuments: Array<{
    codeNumber: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
}

/**
 * Input for marking submission as duplicate suppressed
 */
export interface MarkDuplicateSuppressedInput {
  trackingId: string;
  originalTrackingId: string;
}

/**
 * Input for marking submission as error
 */
export interface MarkSubmissionErrorInput {
  trackingId: string;
  errorCode: string;
  errorMessage: string;
  correlationId?: string;
  retryAfterSeconds?: number;
}

/**
 * Submission record from database
 */
export interface SubmissionRecord {
  trackingId: string;
  sessionId: string;
  env: string;
  payloadHash: string;
  upstreamSubmissionUid: string | null;
  status: string;
  upstreamOverallStatus: string | null;
  correlationId: string | null;
  retryAfterSeconds: number | null;
  errorMessage: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Document record from database
 */
export interface DocumentRecord {
  id: string;
  submissionTrackingId: string;
  codeNumber: string;
  upstreamUuid: string | null;
  initialResult: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * Submission with documents
 */
export interface SubmissionWithDocuments extends SubmissionRecord {
  documents: DocumentRecord[];
}

/**
 * Idempotency window record
 */
export interface IdempotencyRecord {
  id: string;
  sessionId: string;
  payloadHash: string;
  submissionTrackingId: string;
  createdAt: Date;
  expiresAt: Date;
}

// === Phase 05: Polling types ===

/**
 * Upstream document status values (from Get Submission API)
 */
export type UpstreamDocumentStatus = "valid" | "invalid" | "pending";

/**
 * Input for scheduling a poll
 */
export interface SchedulePollInput {
  trackingId: string;
  nextPollAt: Date;
}

/**
 * Input for updating polling state after a poll attempt
 */
export interface UpdatePollStateInput {
  trackingId: string;
  lastPolledAt: Date;
  nextPollAt: Date | null;
  pollAttempts: number;
  upstreamOverallStatus?: string;
  lastUpstreamCorrelationId?: string;
  lastPollErrorCode?: string;
  lastPollErrorMessage?: string;
}

/**
 * Input for marking submission as finalized
 */
export interface FinalizeSubmissionInput {
  trackingId: string;
  upstreamOverallStatus: string;
  finalizedAt: Date;
  lastUpstreamCorrelationId?: string;
}

/**
 * Input for updating document from poll response
 */
export interface UpdateDocumentFromPollInput {
  submissionTrackingId: string;
  upstreamUuid: string;
  upstreamStatus: string;
  longId?: string;
  dateTimeValidated?: Date;
  issuerTin?: string;
  issuerName?: string;
  receiverId?: string;
  receiverName?: string;
  totalPayableAmount?: string;
}

/**
 * Submission record with polling fields (Phase 05)
 */
export interface SubmissionRecordWithPolling extends SubmissionRecord {
  lastPolledAt: Date | null;
  nextPollAt: Date | null;
  pollAttempts: number;
  finalizedAt: Date | null;
  lastUpstreamCorrelationId: string | null;
  lastPollErrorCode: string | null;
  lastPollErrorMessage: string | null;
}

/**
 * Document record with polling fields (Phase 05)
 */
export interface DocumentRecordWithPolling extends DocumentRecord {
  upstreamStatus: string | null;
  longId: string | null;
  dateTimeValidated: Date | null;
  issuerTin: string | null;
  issuerName: string | null;
  receiverId: string | null;
  receiverName: string | null;
  totalPayableAmount: string | null;
}

/**
 * Submission with documents including polling fields
 */
export interface SubmissionWithDocumentsAndPolling extends SubmissionRecordWithPolling {
  documents: DocumentRecordWithPolling[];
}

// === Phase 06: Document action types ===

/**
 * Document action type
 */
export type DocumentActionType = "CANCEL" | "REJECT";

/**
 * Input for recording document action result
 */
export interface RecordDocumentActionInput {
  /** Document UUID */
  uuid: string;
  /** Action type */
  actionType: DocumentActionType;
  /** Reason for the action */
  reason: string;
  /** Resulting status from upstream */
  upstreamStatus: string;
  /** Correlation ID from upstream */
  correlationId?: string;
}

/**
 * Input for recording document action error
 */
export interface RecordDocumentActionErrorInput {
  /** Document UUID */
  uuid: string;
  /** Action type that failed */
  actionType: DocumentActionType;
  /** Reason that was provided */
  reason: string;
  /** Error code */
  errorCode: string;
  /** Error message */
  errorMessage: string;
  /** Retry-After seconds (if rate limited) */
  retryAfterSeconds?: number;
}

/**
 * Input for recording document details snapshot
 */
export interface RecordDocumentDetailsInput {
  /** Document UUID */
  uuid: string;
  /** Status from upstream */
  status: string;
  /** Long ID */
  longId?: string;
  /** Date time validated */
  dateTimeValidated?: Date;
  /** Date time issued */
  dateTimeIssued?: Date;
  /** Date time received */
  dateTimeReceived?: Date;
  /** Cancel date time */
  cancelDateTime?: Date;
  /** Reject date time */
  rejectDateTime?: Date;
  /** Issuer TIN */
  issuerTin?: string;
  /** Issuer name */
  issuerName?: string;
  /** Receiver ID */
  receiverId?: string;
  /** Receiver name */
  receiverName?: string;
  /** Total payable amount */
  totalPayableAmount?: string;
  /** Status reason */
  statusReason?: string;
  /** Correlation ID from upstream */
  correlationId?: string;
}

/**
 * Document record with action fields (Phase 06)
 */
export interface DocumentRecordWithActions extends DocumentRecordWithPolling {
  lastActionType: string | null;
  lastActionReason: string | null;
  lastActionAt: Date | null;
  lastActionStatus: string | null;
  lastActionCorrelationId: string | null;
  lastActionErrorCode: string | null;
  lastActionErrorMessage: string | null;
  dateTimeIssued: Date | null;
  dateTimeReceived: Date | null;
  cancelDateTime: Date | null;
  rejectDateTime: Date | null;
  statusReason: string | null;
  updatedAt: Date;
}

// === Phase 07: TIN Validation Cache types ===

/**
 * ID type for TIN validation
 */
export type TinIdType = "NRIC" | "PASSPORT" | "BRN" | "ARMY";

/**
 * TIN validation result
 */
export type TinValidationResult = "VALID" | "INVALID";

/**
 * Input for getting TIN validation cache
 */
export interface GetTinCacheInput {
  /** Environment */
  env: StorageEnvironment;
  /** Session ID */
  sessionId: string;
  /** TIN to validate */
  tin: string;
  /** ID type */
  idType: TinIdType;
  /** Hashed ID value (SHA256 of idValue + salt) */
  idValueHash: string;
}

/**
 * Input for setting TIN validation cache
 */
export interface SetTinCacheInput extends GetTinCacheInput {
  /** Validation result */
  result: TinValidationResult;
  /** Taxpayer name (only for VALID results) */
  taxpayerName?: string;
  /** When this cache entry expires */
  expiresAt: Date;
  /** Correlation ID from upstream */
  correlationId?: string;
}

/**
 * TIN validation cache record
 */
export interface TinValidateCacheRecord {
  id: string;
  env: string;
  sessionId: string;
  tin: string;
  idType: string;
  idValueHash: string;
  result: string;
  taxpayerName: string | null;
  validatedAt: Date;
  expiresAt: Date;
  correlationId: string | null;
}
