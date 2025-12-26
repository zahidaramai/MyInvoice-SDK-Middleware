/**
 * MyInvois recommended rate limits (RPM per Client ID)
 * Source: https://sdk.myinvois.hasil.gov.my/integration-practices/
 */

export const RATE_LIMITS = {
  /** Login endpoints (taxpayer + intermediary) */
  LOGIN: 12,
  /** Submit documents */
  SUBMIT: 100,
  /** Get submission status */
  GET_SUBMISSION: 300,
  /** Cancel document */
  CANCEL: 12,
  /** Reject document */
  REJECT: 12,
  /** Get document details */
  GET_DOCUMENT_DETAILS: 125,
  /** Validate TIN */
  VALIDATE_TIN: 60,
  /** Get recent documents */
  GET_RECENT: 60,
  /** Search documents */
  SEARCH: 60,
  /** Get notifications */
  GET_NOTIFICATIONS: 60,
} as const;

export type RateLimitCategory = keyof typeof RATE_LIMITS;
