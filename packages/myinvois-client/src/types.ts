/**
 * Types for MyInvois client
 */

import type { Environment, Mode } from "@myinvois/core";

/**
 * Session credentials for MyInvois API access
 */
export interface SessionCredentials {
  sessionId: string;
  env: Environment;
  mode: Mode;
  clientId: string;
  clientSecret: string;
  scope?: string;
  /** Required for INTERMEDIARY mode - taxpayer TIN or "TIN:ROB" */
  onBehalfOf?: string;
}

/**
 * Token response from MyInvois identity service
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Cached token with expiry
 */
export interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Upstream response metadata
 */
export interface UpstreamMeta {
  correlationId?: string;
  rateLimitLimit?: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

/**
 * Upstream error details
 */
export interface UpstreamError {
  status: number;
  message: string;
  code?: string;
  meta?: UpstreamMeta;
}

/**
 * Login result
 */
export type LoginResult =
  | { ok: true; token: CachedToken; meta: UpstreamMeta }
  | { ok: false; error: UpstreamError };

/**
 * HTTP request options
 */
export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  authRequired?: boolean;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * HTTP response wrapper
 */
export interface MyInvoisResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: UpstreamError;
  meta: UpstreamMeta;
}
