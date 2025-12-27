/**
 * Search Documents API - GET /api/v1.0/documents/search
 *
 * Search documents with various filter criteria.
 */

import { resolveSystemBaseUrl, type RateLimiter } from "@myinvois/core";
import type { SessionCredentials, UpstreamMeta, UpstreamError } from "../types.js";
import { TokenManager } from "../tokenManager.js";
import { RATE_LIMITS } from "../rateLimits.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for searching documents
 */
export interface SearchDocumentsParams {
  /** UUID of the document */
  uuid?: string;
  /** Submission UID */
  submissionUid?: string;
  /** Page number (1-based, default 1) */
  pageNo?: number;
  /** Page size (default 10, max 100) */
  pageSize?: number;
  /** Filter by submission date from (ISO 8601) */
  submissionDateFrom?: string;
  /** Filter by submission date to (ISO 8601) */
  submissionDateTo?: string;
  /** Filter by continuationToken for pagination */
  continuationToken?: string;
  /** Filter by issue date from (ISO 8601) */
  issueDateFrom?: string;
  /** Filter by issue date to (ISO 8601) */
  issueDateTo?: string;
  /** Filter by direction */
  direction?: string;
  /** Filter by document status */
  status?: string;
  /** Filter by document type */
  documentType?: string;
  /** Filter by receiver ID */
  receiverId?: string;
  /** Filter by receiver TIN */
  receiverTin?: string;
  /** Filter by issuer TIN */
  issuerTin?: string;
}

/**
 * Search document item from upstream
 */
export interface SearchDocumentUpstream {
  uuid: string;
  submissionUid: string;
  longId?: string;
  internalId: string;
  typeName: string;
  typeVersionName?: string;
  issuerTin: string;
  issuerName?: string;
  receiverId?: string;
  receiverName?: string;
  dateTimeIssued?: string;
  dateTimeReceived?: string;
  dateTimeValidated?: string;
  totalExcludingTax?: number;
  totalDiscount?: number;
  totalNetAmount?: number;
  totalPayableAmount?: number;
  status: string;
  cancelDateTime?: string;
  rejectDateTime?: string;
}

/**
 * Upstream response for search documents
 */
export interface SearchDocumentsUpstreamResponse {
  result: SearchDocumentUpstream[];
  metadata?: {
    totalPages?: number;
    totalCount?: number;
    continuationToken?: string;
  };
}

/**
 * Normalized search document
 */
export interface SearchDocument {
  uuid: string;
  submissionUid: string;
  longId: string | null;
  internalId: string;
  typeName: string;
  typeVersionName: string | null;
  issuerTin: string;
  issuerName: string | null;
  receiverId: string | null;
  receiverName: string | null;
  dateTimeIssued: Date | null;
  dateTimeReceived: Date | null;
  dateTimeValidated: Date | null;
  totalPayableAmount: string | null;
  status: string;
  cancelDateTime: Date | null;
  rejectDateTime: Date | null;
}

/**
 * Result for search documents
 */
export interface SearchDocumentsResult {
  documents: SearchDocument[];
  totalPages: number | null;
  totalCount: number | null;
  continuationToken: string | null;
  meta: UpstreamMeta;
}

/**
 * Response type for searchDocuments
 */
export type SearchDocumentsResponse =
  | { ok: true; result: SearchDocumentsResult }
  | { ok: false; error: UpstreamError };

// =============================================================================
// Helper Functions
// =============================================================================

function extractUpstreamMeta(headers: Headers): UpstreamMeta {
  const meta: UpstreamMeta = {};

  const correlationId = headers.get("correlationid") || headers.get("x-correlation-id");
  if (correlationId) meta.correlationId = correlationId;

  const limit = headers.get("x-rate-limit-limit");
  if (limit) meta.rateLimitLimit = parseInt(limit, 10);

  const remaining = headers.get("x-rate-limit-remaining");
  if (remaining) meta.rateLimitRemaining = parseInt(remaining, 10);

  const reset = headers.get("x-rate-limit-reset");
  if (reset) meta.rateLimitReset = parseInt(reset, 10);

  return meta;
}

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

function buildQueryString(params: SearchDocumentsParams): string {
  const searchParams = new URLSearchParams();

  if (params.uuid) searchParams.set("uuid", params.uuid);
  if (params.submissionUid) searchParams.set("submissionUid", params.submissionUid);
  if (params.pageNo !== undefined) searchParams.set("pageNo", params.pageNo.toString());
  if (params.pageSize !== undefined) searchParams.set("pageSize", params.pageSize.toString());
  if (params.submissionDateFrom) searchParams.set("submissionDateFrom", params.submissionDateFrom);
  if (params.submissionDateTo) searchParams.set("submissionDateTo", params.submissionDateTo);
  if (params.continuationToken) searchParams.set("continuationToken", params.continuationToken);
  if (params.issueDateFrom) searchParams.set("issueDateFrom", params.issueDateFrom);
  if (params.issueDateTo) searchParams.set("issueDateTo", params.issueDateTo);
  if (params.direction) searchParams.set("direction", params.direction);
  if (params.status) searchParams.set("status", params.status);
  if (params.documentType) searchParams.set("documentType", params.documentType);
  if (params.receiverId) searchParams.set("receiverId", params.receiverId);
  if (params.receiverTin) searchParams.set("receiverTin", params.receiverTin);
  if (params.issuerTin) searchParams.set("issuerTin", params.issuerTin);

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

function normalizeDocument(doc: SearchDocumentUpstream): SearchDocument {
  return {
    uuid: doc.uuid,
    submissionUid: doc.submissionUid,
    longId: doc.longId ?? null,
    internalId: doc.internalId,
    typeName: doc.typeName,
    typeVersionName: doc.typeVersionName ?? null,
    issuerTin: doc.issuerTin,
    issuerName: doc.issuerName ?? null,
    receiverId: doc.receiverId ?? null,
    receiverName: doc.receiverName ?? null,
    dateTimeIssued: parseDate(doc.dateTimeIssued),
    dateTimeReceived: parseDate(doc.dateTimeReceived),
    dateTimeValidated: parseDate(doc.dateTimeValidated),
    totalPayableAmount: doc.totalPayableAmount !== undefined ? doc.totalPayableAmount.toString() : null,
    status: doc.status,
    cancelDateTime: parseDate(doc.cancelDateTime),
    rejectDateTime: parseDate(doc.rejectDateTime),
  };
}

// =============================================================================
// API Function
// =============================================================================

export interface SearchDocumentsOptions {
  tokenManager: TokenManager;
  rateLimiter?: RateLimiter;
}

/**
 * Search documents in MyInvois
 *
 * @param session - Session credentials
 * @param params - Search parameters
 * @param options - Options with token manager
 * @returns Search documents response
 */
export async function searchDocuments(
  session: SessionCredentials,
  params: SearchDocumentsParams = {},
  options: SearchDocumentsOptions
): Promise<SearchDocumentsResponse> {
  const { tokenManager, rateLimiter } = options;

  // Check rate limit if limiter provided
  if (rateLimiter) {
    const result = rateLimiter.consume(session.clientId, RATE_LIMITS.SEARCH_DOCUMENTS);
    if (!result.allowed) {
      return {
        ok: false,
        error: {
          status: 429,
          message: "Search documents rate limit exceeded",
          code: "RATE_LIMIT_EXCEEDED",
          meta: {
            rateLimitLimit: result.limit,
            rateLimitRemaining: result.remaining,
          },
        },
      };
    }
  }

  const tokenResult = await tokenManager.getToken(session);
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error };
  }

  const baseUrl = resolveSystemBaseUrl(session.env);
  const queryString = buildQueryString(params);
  const url = `${baseUrl}/api/v1.0/documents/search${queryString}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenResult.token.accessToken}`,
    Accept: "application/json",
  };

  // Add onbehalfof header for intermediary mode
  if (session.onBehalfOf) {
    headers["onbehalfof"] = session.onBehalfOf;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    const meta = extractUpstreamMeta(response.headers);

    if (response.ok) {
      const data = (await response.json()) as SearchDocumentsUpstreamResponse;
      const documents = (data.result || []).map(normalizeDocument);

      return {
        ok: true,
        result: {
          documents,
          totalPages: data.metadata?.totalPages ?? null,
          totalCount: data.metadata?.totalCount ?? null,
          continuationToken: data.metadata?.continuationToken ?? null,
          meta,
        },
      };
    }

    // Handle 429 - Rate limit
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      return {
        ok: false,
        error: {
          status: 429,
          message: "Upstream rate limit exceeded",
          code: "UPSTREAM_RATE_LIMIT",
          meta: {
            ...meta,
            rateLimitReset: retryAfter ? parseInt(retryAfter, 10) : undefined,
          },
        },
      };
    }

    // Handle 401 - Unauthorized
    if (response.status === 401) {
      const refreshResult = await tokenManager.refreshToken(session);
      if (refreshResult.ok) {
        headers.Authorization = `Bearer ${refreshResult.token.accessToken}`;
        const retryResponse = await fetch(url, { method: "GET", headers });
        const retryMeta = extractUpstreamMeta(retryResponse.headers);

        if (retryResponse.ok) {
          const data = (await retryResponse.json()) as SearchDocumentsUpstreamResponse;
          const documents = (data.result || []).map(normalizeDocument);

          return {
            ok: true,
            result: {
              documents,
              totalPages: data.metadata?.totalPages ?? null,
              totalCount: data.metadata?.totalCount ?? null,
              continuationToken: data.metadata?.continuationToken ?? null,
              meta: retryMeta,
            },
          };
        }
      }

      return {
        ok: false,
        error: {
          status: 401,
          message: "Unauthorized",
          code: "UNAUTHORIZED",
          meta,
        },
      };
    }

    // Handle other errors
    const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: false,
      error: {
        status: response.status,
        message: (errorBody.message as string) || `Request failed with status ${response.status}`,
        code: (errorBody.code as string) || "UPSTREAM_ERROR",
        meta,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        status: 0,
        message: error instanceof Error ? error.message : "Network error",
        code: "NETWORK_ERROR",
      },
    };
  }
}
