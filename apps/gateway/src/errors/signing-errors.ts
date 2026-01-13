/**
 * Signing error transformation
 *
 * Transforms signing package errors to user-friendly ErrorEnvelope format.
 */

import { ErrorCodes, createErrorEnvelope, type ErrorEnvelope } from "@myinvois/core";
import {
  CertificateLoadError,
  PrivateKeyLoadError,
  CertificateExpiredError,
  CertificateNotYetValidError,
  KeyCertificateMismatchError,
  SignatureGenerationError,
  SignatureVerificationError,
  SigningError,
} from "@myinvois/signing";

/**
 * Signing context for error envelopes
 */
export interface SigningErrorContext {
  /** Phase where the error occurred */
  phase: "loading" | "signing" | "verification";
  /** Certificate subject (if available) */
  certificateSubject?: string;
  /** Document version being used */
  documentVersion?: string;
  /** Document code number (if applicable) */
  documentCodeNumber?: string;
}

/**
 * Extended error envelope with signing context
 */
export interface SigningErrorEnvelope extends ErrorEnvelope {
  /** Signing-specific context */
  signing?: SigningErrorContext;
}

/**
 * Transform a signing error to ErrorEnvelope format
 *
 * @param error - The error from the signing package
 * @param context - Additional context about the signing operation
 * @param correlationId - Correlation ID for tracking
 * @returns ErrorEnvelope with signing context
 */
export function transformSigningError(
  error: unknown,
  context?: Partial<SigningErrorContext>,
  correlationId?: string
): SigningErrorEnvelope {
  // Default signing context
  const signingContext: SigningErrorContext = {
    phase: context?.phase || "signing",
    certificateSubject: context?.certificateSubject,
    documentVersion: context?.documentVersion,
    documentCodeNumber: context?.documentCodeNumber,
  };

  // Certificate loading errors
  if (error instanceof CertificateLoadError) {
    const envelope = createErrorEnvelope(
      ErrorCodes.CERTIFICATE_LOAD_FAILED,
      `Failed to load signing certificate: ${error.message}`,
      500,
      {
        retryable: false,
        correlationId,
      }
    );
    return {
      ...envelope,
      signing: { ...signingContext, phase: "loading" },
    };
  }

  if (error instanceof CertificateExpiredError) {
    const envelope = createErrorEnvelope(
      ErrorCodes.CERTIFICATE_EXPIRED,
      `Signing certificate has expired: ${error.message}`,
      503,
      {
        retryable: false,
        correlationId,
      }
    );
    return {
      ...envelope,
      signing: {
        ...signingContext,
        phase: "loading",
        certificateSubject: error.subject,
      },
    };
  }

  if (error instanceof CertificateNotYetValidError) {
    const envelope = createErrorEnvelope(
      ErrorCodes.CERTIFICATE_NOT_YET_VALID,
      `Signing certificate is not yet valid: ${error.message}`,
      503,
      {
        retryable: false,
        correlationId,
      }
    );
    return {
      ...envelope,
      signing: {
        ...signingContext,
        phase: "loading",
        certificateSubject: error.subject,
      },
    };
  }

  // Private key loading errors
  if (error instanceof PrivateKeyLoadError) {
    const envelope = createErrorEnvelope(
      ErrorCodes.PRIVATE_KEY_LOAD_FAILED,
      `Failed to load private key: ${error.message}`,
      500,
      {
        retryable: false,
        correlationId,
      }
    );
    return {
      ...envelope,
      signing: { ...signingContext, phase: "loading" },
    };
  }

  // Key-certificate mismatch
  if (error instanceof KeyCertificateMismatchError) {
    const certificateSubject = error.context?.certificateSubject as string | undefined;
    const envelope = createErrorEnvelope(
      ErrorCodes.KEY_CERTIFICATE_MISMATCH,
      `Private key does not match certificate: ${error.message}`,
      500,
      {
        retryable: false,
        correlationId,
      }
    );
    return {
      ...envelope,
      signing: {
        ...signingContext,
        phase: "loading",
        certificateSubject,
      },
    };
  }

  // Signature generation errors
  if (error instanceof SignatureGenerationError) {
    const envelope = createErrorEnvelope(
      ErrorCodes.SIGNING_FAILED,
      `Failed to generate signature: ${error.message}`,
      500,
      {
        retryable: false,
        correlationId,
      }
    );
    return {
      ...envelope,
      signing: { ...signingContext, phase: "signing" },
    };
  }

  // Signature verification errors
  if (error instanceof SignatureVerificationError) {
    const envelope = createErrorEnvelope(
      ErrorCodes.SIGNATURE_VERIFICATION_FAILED,
      `Signature verification failed: ${error.message}`,
      400,
      {
        retryable: false,
        correlationId,
      }
    );
    return {
      ...envelope,
      signing: { ...signingContext, phase: "verification" },
    };
  }

  // Generic signing errors
  if (error instanceof SigningError) {
    const envelope = createErrorEnvelope(
      ErrorCodes.SIGNING_FAILED,
      `Signing error: ${error.message}`,
      500,
      {
        retryable: false,
        correlationId,
      }
    );
    return {
      ...envelope,
      signing: signingContext,
    };
  }

  // Unknown errors (fallback)
  const message = error instanceof Error ? error.message : "Unknown signing error";
  const envelope = createErrorEnvelope(
    ErrorCodes.SIGNING_FAILED,
    message,
    500,
    {
      retryable: false,
      correlationId,
    }
  );
  return {
    ...envelope,
    signing: signingContext,
  };
}

/**
 * Check if an error is a signing-related error
 */
export function isSigningError(error: unknown): boolean {
  return (
    error instanceof SigningError ||
    error instanceof CertificateLoadError ||
    error instanceof PrivateKeyLoadError ||
    error instanceof CertificateExpiredError ||
    error instanceof CertificateNotYetValidError ||
    error instanceof KeyCertificateMismatchError ||
    error instanceof SignatureGenerationError ||
    error instanceof SignatureVerificationError
  );
}

/**
 * Create a signing not configured error
 */
export function createSigningNotConfiguredError(
  documentVersion: string,
  correlationId?: string
): SigningErrorEnvelope {
  const envelope = createErrorEnvelope(
    ErrorCodes.SIGNING_NOT_CONFIGURED,
    `Signing is required for document version ${documentVersion} but is not configured`,
    503,
    {
      retryable: false,
      correlationId,
    }
  );
  return {
    ...envelope,
    signing: {
      phase: "loading",
      documentVersion,
    },
  };
}

/**
 * Create a signing disabled error
 */
export function createSigningDisabledError(
  correlationId?: string
): SigningErrorEnvelope {
  const envelope = createErrorEnvelope(
    ErrorCodes.SIGNING_DISABLED,
    "Document signing is disabled in the current configuration",
    503,
    {
      retryable: false,
      correlationId,
    }
  );
  return {
    ...envelope,
    signing: {
      phase: "loading",
    },
  };
}

/**
 * Create an invalid document version error
 */
export function createInvalidDocumentVersionError(
  version: string,
  correlationId?: string
): SigningErrorEnvelope {
  const envelope = createErrorEnvelope(
    ErrorCodes.INVALID_DOCUMENT_VERSION,
    `Invalid document version: ${version}. Valid versions are '1.0' and '1.1'.`,
    400,
    {
      retryable: false,
      correlationId,
      field: "documentVersion",
    }
  );
  return {
    ...envelope,
    signing: {
      phase: "loading",
      documentVersion: version,
    },
  };
}
