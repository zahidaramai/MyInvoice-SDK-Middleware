/**
 * Types for Taxpayer API endpoints
 */

import type { UpstreamMeta, UpstreamError } from "../types.js";

/**
 * ID type for taxpayer validation
 */
export type IdType = "NRIC" | "PASSPORT" | "BRN" | "ARMY";

/**
 * Parameters for validateTaxpayerTin
 */
export interface ValidateTinParams {
  /** Tax Identification Number */
  tin: string;
  /** ID type */
  idType: IdType;
  /** ID value (NRIC, passport number, BRN, or army number) */
  idValue: string;
}

/**
 * Upstream response for TIN validation (200 OK)
 */
export interface ValidateTinUpstreamResponse {
  /** Whether the TIN is valid */
  isValid?: boolean;
  /** Taxpayer name (if available) */
  name?: string;
}

/**
 * Result for successful TIN validation
 */
export interface ValidateTinResult {
  /** Whether the TIN is valid */
  valid: boolean;
  /** TIN that was validated */
  tin: string;
  /** Taxpayer name (if returned by upstream) */
  name?: string;
  /** Upstream metadata */
  meta: UpstreamMeta;
}

/**
 * Response type for validateTaxpayerTin
 */
export type ValidateTinResponse =
  | { ok: true; result: ValidateTinResult }
  | { ok: false; error: UpstreamError };
