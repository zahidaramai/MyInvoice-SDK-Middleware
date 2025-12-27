/**
 * Document Types API - GET /api/v1.0/documenttypes
 *
 * Retrieves available document types and versions from MyInvois.
 */

import { resolveSystemBaseUrl } from "@myinvois/core";
import type { SessionCredentials, UpstreamMeta, UpstreamError } from "../types.js";
import { TokenManager } from "../tokenManager.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Document type version
 */
export interface DocumentTypeVersion {
  id: number;
  name: string;
  description?: string;
  activeFrom?: string;
  activeTo?: string;
  versionNumber: number;
  status: "draft" | "published" | "deactivated";
}

/**
 * Document type
 */
export interface DocumentType {
  id: number;
  invoiceTypeCode: number;
  description: string;
  activeFrom?: string;
  activeTo?: string;
  documentTypeVersions?: DocumentTypeVersion[];
}

/**
 * Get all document types response
 */
export interface GetAllDocumentTypesResult {
  documentTypes: DocumentType[];
  meta: UpstreamMeta;
}

export type GetAllDocumentTypesResponse =
  | { ok: true; result: GetAllDocumentTypesResult }
  | { ok: false; error: UpstreamError };

/**
 * Get document type by ID response
 */
export interface GetDocumentTypeResult {
  documentType: DocumentType;
  meta: UpstreamMeta;
}

export type GetDocumentTypeResponse =
  | { ok: true; result: GetDocumentTypeResult }
  | { ok: false; error: UpstreamError };

/**
 * Get document type version response
 */
export interface GetDocumentTypeVersionResult {
  version: DocumentTypeVersion;
  meta: UpstreamMeta;
}

export type GetDocumentTypeVersionResponse =
  | { ok: true; result: GetDocumentTypeVersionResult }
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

  return meta;
}

// =============================================================================
// API Functions
// =============================================================================

export interface DocumentTypesOptions {
  tokenManager: TokenManager;
}

/**
 * Get all document types
 *
 * @param session - Session credentials
 * @param options - Options with token manager
 * @returns All available document types
 */
export async function getAllDocumentTypes(
  session: SessionCredentials,
  options: DocumentTypesOptions
): Promise<GetAllDocumentTypesResponse> {
  const { tokenManager } = options;

  const tokenResult = await tokenManager.getToken(session);
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error };
  }

  const baseUrl = resolveSystemBaseUrl(session.env);
  const url = `${baseUrl}/api/v1.0/documenttypes`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenResult.token.accessToken}`,
        Accept: "application/json",
      },
    });

    const meta = extractUpstreamMeta(response.headers);

    if (response.ok) {
      const data = (await response.json()) as DocumentType[] | { result: DocumentType[] };
      // Response could be array or object with result property
      const documentTypes = Array.isArray(data) ? data : data.result || [];

      return {
        ok: true,
        result: {
          documentTypes,
          meta,
        },
      };
    }

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

/**
 * Get document type by ID
 *
 * @param session - Session credentials
 * @param id - Document type ID
 * @param options - Options with token manager
 * @returns Document type details
 */
export async function getDocumentTypeById(
  session: SessionCredentials,
  id: number,
  options: DocumentTypesOptions
): Promise<GetDocumentTypeResponse> {
  const { tokenManager } = options;

  const tokenResult = await tokenManager.getToken(session);
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error };
  }

  const baseUrl = resolveSystemBaseUrl(session.env);
  const url = `${baseUrl}/api/v1.0/documenttypes/${id}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenResult.token.accessToken}`,
        Accept: "application/json",
      },
    });

    const meta = extractUpstreamMeta(response.headers);

    if (response.ok) {
      const documentType = (await response.json()) as DocumentType;
      return {
        ok: true,
        result: {
          documentType,
          meta,
        },
      };
    }

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

/**
 * Get document type version by ID
 *
 * @param session - Session credentials
 * @param typeId - Document type ID
 * @param versionId - Version ID
 * @param options - Options with token manager
 * @returns Document type version details
 */
export async function getDocumentTypeVersionById(
  session: SessionCredentials,
  typeId: number,
  versionId: number,
  options: DocumentTypesOptions
): Promise<GetDocumentTypeVersionResponse> {
  const { tokenManager } = options;

  const tokenResult = await tokenManager.getToken(session);
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error };
  }

  const baseUrl = resolveSystemBaseUrl(session.env);
  const url = `${baseUrl}/api/v1.0/documenttypes/${typeId}/versions/${versionId}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenResult.token.accessToken}`,
        Accept: "application/json",
      },
    });

    const meta = extractUpstreamMeta(response.headers);

    if (response.ok) {
      const version = (await response.json()) as DocumentTypeVersion;
      return {
        ok: true,
        result: {
          version,
          meta,
        },
      };
    }

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
