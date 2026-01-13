/**
 * Types for e-Invoice API endpoints
 */

import type { UpstreamMeta, UpstreamError } from "../types.js";

/**
 * Document format for submission
 */
export type DocumentFormat = "XML" | "JSON";

/**
 * Single document in a submission request to MyInvois
 *
 * IMPORTANT: Document Hash Encoding
 * ---------------------------------
 * The documentHash MUST be SHA256 encoded as HEXADECIMAL (not base64!).
 * This is a MyInvois requirement that differs from common practice.
 *
 * Correct:
 *   const jsonString = JSON.stringify(signedDocument);
 *   const documentHash = crypto.createHash('sha256').update(jsonString, 'utf-8').digest('hex');
 *
 * Incorrect (will cause "Document hash is not valid" error):
 *   const documentHash = crypto.createHash('sha256').update(jsonString).digest('base64');
 *
 * Use the `computeDocumentHash` or `prepareDocumentForSubmission` helpers from @myinvois/core
 * for correct hash computation.
 */
export interface SubmitDocumentInput {
  /** Document format: XML or JSON */
  format: DocumentFormat;
  /** Base64-encoded document content (UTF-8 JSON stringified, then base64 encoded) */
  document: string;
  /**
   * SHA256 hash of the document content.
   * IMPORTANT: Must be HEX encoded (not base64!)
   * Hash the UTF-8 JSON string, encode result as lowercase hex.
   */
  documentHash: string;
  /** Code number (invoice/document reference) */
  codeNumber: string;
}

/**
 * Submission request to MyInvois API
 */
export interface SubmitDocumentsRequest {
  documents: SubmitDocumentInput[];
}

/**
 * Accepted document in submission response
 */
export interface AcceptedDocumentResponse {
  /** Document UUID assigned by MyInvois */
  uuid: string;
  /** Invoice code number */
  invoiceCodeNumber: string;
}

/**
 * Error details for rejected document
 */
export interface DocumentError {
  code?: string;
  message?: string;
  target?: string;
  propertyName?: string;
  propertyPath?: string;
  details?: DocumentError[];
  innerError?: DocumentError[];
}

/**
 * Rejected document in submission response
 */
export interface RejectedDocumentResponse {
  /** Invoice code number */
  invoiceCodeNumber: string;
  /** Error details */
  error: DocumentError;
}

/**
 * Raw upstream response from MyInvois Submit Documents API
 */
export interface SubmitDocumentsUpstreamResponse {
  /** Submission UID assigned by MyInvois */
  submissionUid: string;
  /** List of accepted documents */
  acceptedDocuments: AcceptedDocumentResponse[];
  /** List of rejected documents */
  rejectedDocuments: RejectedDocumentResponse[];
}

/**
 * Normalized accepted document for gateway response
 */
export interface NormalizedAcceptedDocument {
  codeNumber: string;
  uuid: string;
}

/**
 * Normalized rejected document for gateway response
 */
export interface NormalizedRejectedDocument {
  codeNumber: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Normalized submission result
 */
export interface SubmitDocumentsResult {
  /** MyInvois submission UID */
  submissionUid: string;
  /** Normalized accepted documents */
  acceptedDocuments: NormalizedAcceptedDocument[];
  /** Normalized rejected documents */
  rejectedDocuments: NormalizedRejectedDocument[];
  /** Upstream metadata */
  meta: UpstreamMeta;
}

/**
 * Submit documents response type
 */
export type SubmitDocumentsResponse =
  | { ok: true; result: SubmitDocumentsResult }
  | { ok: false; error: UpstreamError };

/**
 * Duplicate submission error details
 */
export interface DuplicateSubmissionError extends UpstreamError {
  code: "DUPLICATE_SUBMISSION";
  retryAfterSeconds?: number;
}

/**
 * Rate limit error details
 */
export interface RateLimitError extends UpstreamError {
  code: "UPSTREAM_RATE_LIMIT" | "RATE_LIMIT_EXCEEDED";
  retryAfterSeconds?: number;
}

// === Phase 05: Get Submission types ===

/**
 * Overall status values from Get Submission API
 */
export type OverallStatus = "in progress" | "valid" | "partially valid" | "invalid";

/**
 * Document status values from Get Submission API
 */
export type DocumentStatus = "valid" | "invalid" | "pending" | "cancelled";

/**
 * Get Submission request parameters
 */
export interface GetSubmissionParams {
  /** MyInvois submission UID */
  submissionUid: string;
  /** Page number (1-based) */
  pageNo?: number;
  /** Page size (max 100) */
  pageSize?: number;
}

/**
 * Document summary from Get Submission response
 */
export interface DocumentSummaryUpstream {
  /** Document UUID */
  uuid: string;
  /** Long ID assigned by MyInvois */
  longId?: string;
  /** Internal ID from the document */
  internalId: string;
  /** Type name (e.g., "invoice") */
  typeName: string;
  /** Type version */
  typeVersionName?: string;
  /** Issuer TIN */
  issuerTin: string;
  /** Issuer name */
  issuerName?: string;
  /** Receiver ID */
  receiverId?: string;
  /** Receiver name */
  receiverName?: string;
  /** Document date time issued */
  dateTimeIssued?: string;
  /** Document date time received by MyInvois */
  dateTimeReceived?: string;
  /** Document date time validated */
  dateTimeValidated?: string;
  /** Total excluding tax */
  totalExcludingTax?: number;
  /** Total discount */
  totalDiscount?: number;
  /** Total net amount */
  totalNetAmount?: number;
  /** Total payable amount */
  totalPayableAmount?: number;
  /** Document status */
  status: DocumentStatus;
  /** Cancel date time */
  cancelDateTime?: string;
  /** Reject date time */
  rejectDateTime?: string;
}

/**
 * Raw upstream response from Get Submission API
 */
export interface GetSubmissionUpstreamResponse {
  /** Submission UID */
  submissionUid: string;
  /** Overall status */
  overallStatus: OverallStatus;
  /** Total number of documents in submission */
  documentCount: number;
  /** Date time received */
  dateTimeReceived: string;
  /** Document summaries */
  documentSummary: DocumentSummaryUpstream[];
}

/**
 * Normalized document summary
 */
export interface NormalizedDocumentSummary {
  /** Document UUID */
  uuid: string;
  /** Long ID (may be null if not yet assigned) */
  longId: string | null;
  /** Invoice code number (from internalId) */
  codeNumber: string;
  /** Document status */
  status: DocumentStatus;
  /** Date time validated */
  dateTimeValidated: Date | null;
  /** Issuer TIN */
  issuerTin: string;
  /** Issuer name */
  issuerName: string | null;
  /** Receiver ID */
  receiverId: string | null;
  /** Receiver name */
  receiverName: string | null;
  /** Total payable amount */
  totalPayableAmount: string | null;
}

/**
 * Normalized Get Submission result
 */
export interface GetSubmissionResult {
  /** MyInvois submission UID */
  submissionUid: string;
  /** Overall status */
  overallStatus: OverallStatus;
  /** Total number of documents */
  documentCount: number;
  /** Date time received */
  dateTimeReceived: Date;
  /** Normalized document summaries */
  documentSummary: NormalizedDocumentSummary[];
  /** Upstream metadata */
  meta: UpstreamMeta;
}

/**
 * Get Submission response type
 */
export type GetSubmissionResponse =
  | { ok: true; result: GetSubmissionResult }
  | { ok: false; error: UpstreamError };

// === Phase 06: Document State Change types ===

/**
 * Document state for state change API
 */
export type DocumentStateAction = "cancelled" | "rejected";

/**
 * Request body for document state change
 */
export interface ChangeDocumentStateRequest {
  /** Target status: cancelled or rejected */
  status: DocumentStateAction;
  /** Reason for the state change */
  reason: string;
}

/**
 * Parameters for changeDocumentState
 */
export interface ChangeDocumentStateParams {
  /** Document UUID */
  uuid: string;
  /** Target status */
  status: DocumentStateAction;
  /** Reason for the action */
  reason: string;
}

/**
 * Upstream response for document state change
 */
export interface ChangeDocumentStateUpstreamResponse {
  /** Document UUID */
  uuid: string;
  /** New status */
  status: string;
}

/**
 * Normalized result for document state change
 */
export interface ChangeDocumentStateResult {
  /** Document UUID */
  uuid: string;
  /** New status */
  status: string;
  /** Upstream metadata */
  meta: UpstreamMeta;
}

/**
 * Response type for changeDocumentState
 */
export type ChangeDocumentStateResponse =
  | { ok: true; result: ChangeDocumentStateResult }
  | { ok: false; error: UpstreamError };

// === Phase 06: Document Details types ===

/**
 * Parameters for getDocumentDetails
 */
export interface GetDocumentDetailsParams {
  /** Document UUID */
  uuid: string;
}

/**
 * Upstream response for document details
 */
export interface DocumentDetailsUpstream {
  /** Document UUID */
  uuid: string;
  /** Submission UID */
  submissionUid: string;
  /** Long ID */
  longId?: string;
  /** Internal ID (invoice number) */
  internalId: string;
  /** Type name */
  typeName: string;
  /** Type version */
  typeVersionName?: string;
  /** Issuer TIN */
  issuerTin: string;
  /** Issuer name */
  issuerName?: string;
  /** Receiver ID */
  receiverId?: string;
  /** Receiver name */
  receiverName?: string;
  /** Date time issued */
  dateTimeIssued?: string;
  /** Date time received */
  dateTimeReceived?: string;
  /** Date time validated */
  dateTimeValidated?: string;
  /** Total excluding tax */
  totalExcludingTax?: number;
  /** Total discount */
  totalDiscount?: number;
  /** Total net amount */
  totalNetAmount?: number;
  /** Total payable amount */
  totalPayableAmount?: number;
  /** Document status */
  status: string;
  /** Cancel date time */
  cancelDateTime?: string;
  /** Reject date time */
  rejectDateTime?: string;
  /** Document hash */
  documentStatusReason?: string;
  /** Created by user ID */
  createdByUserId?: string;
}

/**
 * Normalized document details result
 */
export interface DocumentDetailsResult {
  /** Document UUID */
  uuid: string;
  /** Submission UID */
  submissionUid: string;
  /** Long ID */
  longId: string | null;
  /** Internal ID (invoice number) */
  internalId: string;
  /** Type name */
  typeName: string;
  /** Issuer TIN */
  issuerTin: string;
  /** Issuer name */
  issuerName: string | null;
  /** Receiver ID */
  receiverId: string | null;
  /** Receiver name */
  receiverName: string | null;
  /** Date time issued */
  dateTimeIssued: Date | null;
  /** Date time received */
  dateTimeReceived: Date | null;
  /** Date time validated */
  dateTimeValidated: Date | null;
  /** Total payable amount */
  totalPayableAmount: string | null;
  /** Document status */
  status: string;
  /** Cancel date time */
  cancelDateTime: Date | null;
  /** Reject date time */
  rejectDateTime: Date | null;
  /** Status reason */
  statusReason: string | null;
  /** Upstream metadata */
  meta: UpstreamMeta;
}

/**
 * Response type for getDocumentDetails
 */
export type GetDocumentDetailsResponse =
  | { ok: true; result: DocumentDetailsResult }
  | { ok: false; error: UpstreamError };
