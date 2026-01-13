/**
 * Signing middleware for document submission
 *
 * Applies digital signatures to documents when:
 * 1. Signing is enabled globally
 * 2. Session requests v1.1 document format
 */

import type { DocumentVersion, SigningResult } from '@myinvois/signing';
import { getSigningService, isSigningAvailable, getDefaultDocumentVersion } from '../config/signing.js';
import { AppError } from '../lib/errors.js';

/**
 * Document to be signed
 */
export interface SignableDocument {
  /** Document content as JSON object */
  content: Record<string, unknown>;
  /** Document code number */
  codeNumber: string;
  /** Original format */
  format: 'JSON' | 'XML';
}

/**
 * Signed document result
 */
export interface SignedDocument {
  /** Original or signed content */
  content: Record<string, unknown>;
  /** Document code number */
  codeNumber: string;
  /** Original format */
  format: 'JSON' | 'XML';
  /** Whether document was signed */
  signed: boolean;
  /** Document hash (from signing) */
  documentHash?: string;
  /** Signing timestamp */
  signedAt?: Date;
}

/**
 * Signing middleware options
 */
export interface SigningOptions {
  /** Document version (1.0 or 1.1) - determines if signing is applied */
  documentVersion: DocumentVersion;
  /** Correlation ID for logging */
  correlationId?: string;
  /** Logger instance */
  logger?: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
    error: (obj: Record<string, unknown>, msg: string) => void;
  };
}

/**
 * Check if signing should be applied for the given version
 */
export function shouldSign(documentVersion: DocumentVersion): boolean {
  return documentVersion === '1.1' && isSigningAvailable();
}

/**
 * Get effective document version
 *
 * Priority: session setting > global default
 */
export function getEffectiveDocumentVersion(
  sessionDocumentVersion?: DocumentVersion
): DocumentVersion {
  // If session specifies a version, use it
  if (sessionDocumentVersion) {
    return sessionDocumentVersion;
  }

  // Fall back to global default
  return getDefaultDocumentVersion();
}

/**
 * Sign a single document
 *
 * @param document - Document to sign
 * @param options - Signing options
 * @returns Signed document result
 * @throws AppError if signing fails
 */
export function signDocument(
  document: SignableDocument,
  options: SigningOptions
): SignedDocument {
  const { documentVersion, correlationId, logger } = options;

  // Check if we should sign
  if (!shouldSign(documentVersion)) {
    // Pass through unchanged for v1.0
    return {
      content: document.content,
      codeNumber: document.codeNumber,
      format: document.format,
      signed: false,
    };
  }

  // Get signing service
  const signingService = getSigningService();
  if (!signingService) {
    throw new AppError(
      503,
      'Signing service unavailable but v1.1 documents requested',
      'SIGNING_NOT_CONFIGURED',
      { correlationId }
    );
  }

  // Check certificate validity
  if (!signingService.isCertificateValid()) {
    throw new AppError(
      503,
      'Signing certificate has expired',
      'CERTIFICATE_EXPIRED',
      { correlationId }
    );
  }

  // Sign the document
  let result: SigningResult;
  try {
    result = signingService.sign(document.content);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown signing error';
    logger?.error(
      { correlationId, codeNumber: document.codeNumber, error: message },
      'Document signing failed'
    );
    throw new AppError(
      500,
      `Failed to sign document ${document.codeNumber}: ${message}`,
      'SIGNING_FAILED',
      { correlationId }
    );
  }

  logger?.info(
    {
      correlationId,
      codeNumber: document.codeNumber,
      documentHash: result.documentHash,
      signedAt: result.signedAt.toISOString(),
    },
    'Document signed successfully'
  );

  return {
    content: result.signedDocument,
    codeNumber: document.codeNumber,
    format: document.format,
    signed: true,
    documentHash: result.documentHash,
    signedAt: result.signedAt,
  };
}

/**
 * Sign multiple documents
 *
 * @param documents - Documents to sign
 * @param options - Signing options
 * @returns Array of signed document results
 * @throws AppError if any signing fails (fails fast)
 */
export function signDocuments(
  documents: SignableDocument[],
  options: SigningOptions
): SignedDocument[] {
  const { documentVersion, correlationId, logger } = options;

  // Quick exit if no signing needed
  if (!shouldSign(documentVersion)) {
    return documents.map((doc) => ({
      content: doc.content,
      codeNumber: doc.codeNumber,
      format: doc.format,
      signed: false,
    }));
  }

  logger?.info(
    { correlationId, documentCount: documents.length, documentVersion },
    'Signing documents for v1.1 submission'
  );

  // Sign each document
  const signedDocuments: SignedDocument[] = [];
  for (const document of documents) {
    const signed = signDocument(document, options);
    signedDocuments.push(signed);
  }

  logger?.info(
    { correlationId, signedCount: signedDocuments.length },
    'All documents signed successfully'
  );

  return signedDocuments;
}

/**
 * Get signing status for a document version request
 *
 * Used to check if signing can be applied before attempting submission
 */
export function getSigningStatus(documentVersion: DocumentVersion): {
  signingRequired: boolean;
  signingAvailable: boolean;
  canProceed: boolean;
  reason?: string;
} {
  const signingRequired = documentVersion === '1.1';
  const signingAvailable = isSigningAvailable();

  if (!signingRequired) {
    return {
      signingRequired: false,
      signingAvailable,
      canProceed: true,
    };
  }

  if (signingRequired && signingAvailable) {
    // Check certificate validity
    const service = getSigningService();
    if (service && !service.isCertificateValid()) {
      return {
        signingRequired: true,
        signingAvailable: true,
        canProceed: false,
        reason: 'Certificate has expired',
      };
    }

    return {
      signingRequired: true,
      signingAvailable: true,
      canProceed: true,
    };
  }

  return {
    signingRequired: true,
    signingAvailable: false,
    canProceed: false,
    reason: 'Signing is required for v1.1 but not configured',
  };
}
