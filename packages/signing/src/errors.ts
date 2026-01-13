/**
 * Error classes for the @myinvois/signing package
 */

/**
 * Error codes for signing-related errors
 */
export enum SigningErrorCode {
  /** Signing is disabled but was requested */
  SIGNING_DISABLED = 'SIGNING_DISABLED',
  /** Failed to load certificate */
  CERTIFICATE_LOAD_FAILED = 'CERTIFICATE_LOAD_FAILED',
  /** Failed to load private key */
  PRIVATE_KEY_LOAD_FAILED = 'PRIVATE_KEY_LOAD_FAILED',
  /** Certificate has expired */
  CERTIFICATE_EXPIRED = 'CERTIFICATE_EXPIRED',
  /** Certificate is not yet valid */
  CERTIFICATE_NOT_YET_VALID = 'CERTIFICATE_NOT_YET_VALID',
  /** Private key does not match certificate */
  KEY_CERTIFICATE_MISMATCH = 'KEY_CERTIFICATE_MISMATCH',
  /** Signing operation failed */
  SIGNING_FAILED = 'SIGNING_FAILED',
  /** Signature verification failed */
  SIGNATURE_VERIFICATION_FAILED = 'SIGNATURE_VERIFICATION_FAILED',
  /** Invalid document version */
  INVALID_DOCUMENT_VERSION = 'INVALID_DOCUMENT_VERSION',
  /** Signing is enabled but not properly configured */
  SIGNING_NOT_CONFIGURED = 'SIGNING_NOT_CONFIGURED'
}

/**
 * Base error class for all signing-related errors
 */
export class SigningError extends Error {
  /** Error code for programmatic handling */
  readonly code: SigningErrorCode;
  /** HTTP status code to return */
  readonly httpStatus: number;
  /** Whether this error is retryable */
  readonly retryable: boolean;
  /** Additional context for debugging */
  readonly context?: Record<string, unknown>;

  constructor(
    code: SigningErrorCode,
    message: string,
    options?: {
      httpStatus?: number;
      retryable?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'SigningError';
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 500;
    this.retryable = options?.retryable ?? false;
    this.context = options?.context;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert to a plain object for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      context: this.context
    };
  }
}

/**
 * Error thrown when certificate loading fails
 */
export class CertificateLoadError extends SigningError {
  constructor(
    message: string,
    options?: {
      source?: 'file' | 'env' | 'base64';
      path?: string;
      cause?: Error;
    }
  ) {
    super(SigningErrorCode.CERTIFICATE_LOAD_FAILED, message, {
      httpStatus: 500,
      retryable: false,
      context: {
        source: options?.source,
        path: options?.path
      },
      cause: options?.cause
    });
    this.name = 'CertificateLoadError';
  }
}

/**
 * Error thrown when private key loading fails
 */
export class PrivateKeyLoadError extends SigningError {
  constructor(
    message: string,
    options?: {
      source?: 'file' | 'env' | 'base64';
      path?: string;
      encrypted?: boolean;
      cause?: Error;
    }
  ) {
    super(SigningErrorCode.PRIVATE_KEY_LOAD_FAILED, message, {
      httpStatus: 500,
      retryable: false,
      context: {
        source: options?.source,
        path: options?.path,
        encrypted: options?.encrypted
      },
      cause: options?.cause
    });
    this.name = 'PrivateKeyLoadError';
  }
}

/**
 * Error thrown when certificate has expired
 */
export class CertificateExpiredError extends SigningError {
  /** Certificate expiry date */
  readonly expiredAt: Date;
  /** Certificate subject */
  readonly subject?: string;

  constructor(
    message: string,
    expiredAt: Date,
    options?: {
      subject?: string;
      cause?: Error;
    }
  ) {
    super(SigningErrorCode.CERTIFICATE_EXPIRED, message, {
      httpStatus: 400,
      retryable: false,
      context: {
        expiredAt: expiredAt.toISOString(),
        subject: options?.subject
      },
      cause: options?.cause
    });
    this.name = 'CertificateExpiredError';
    this.expiredAt = expiredAt;
    this.subject = options?.subject;
  }
}

/**
 * Error thrown when certificate is not yet valid
 */
export class CertificateNotYetValidError extends SigningError {
  /** Certificate validity start date */
  readonly validFrom: Date;
  /** Certificate subject */
  readonly subject?: string;

  constructor(
    message: string,
    validFrom: Date,
    options?: {
      subject?: string;
      cause?: Error;
    }
  ) {
    super(SigningErrorCode.CERTIFICATE_NOT_YET_VALID, message, {
      httpStatus: 400,
      retryable: false,
      context: {
        validFrom: validFrom.toISOString(),
        subject: options?.subject
      },
      cause: options?.cause
    });
    this.name = 'CertificateNotYetValidError';
    this.validFrom = validFrom;
    this.subject = options?.subject;
  }
}

/**
 * Error thrown when private key does not match certificate
 */
export class KeyCertificateMismatchError extends SigningError {
  constructor(
    message: string,
    options?: {
      certificateSubject?: string;
      cause?: Error;
    }
  ) {
    super(SigningErrorCode.KEY_CERTIFICATE_MISMATCH, message, {
      httpStatus: 500,
      retryable: false,
      context: {
        certificateSubject: options?.certificateSubject
      },
      cause: options?.cause
    });
    this.name = 'KeyCertificateMismatchError';
  }
}

/**
 * Error thrown when document signing fails
 */
export class SignatureGenerationError extends SigningError {
  constructor(
    message: string,
    options?: {
      algorithm?: string;
      documentId?: string;
      cause?: Error;
    }
  ) {
    super(SigningErrorCode.SIGNING_FAILED, message, {
      httpStatus: 500,
      retryable: true,
      context: {
        algorithm: options?.algorithm,
        documentId: options?.documentId
      },
      cause: options?.cause
    });
    this.name = 'SignatureGenerationError';
  }
}

/**
 * Error thrown when signature verification fails
 */
export class SignatureVerificationError extends SigningError {
  /** Type of verification failure */
  readonly failureType: 'hash_mismatch' | 'invalid_signature' | 'certificate_issue' | 'missing_signature' | 'malformed';

  constructor(
    message: string,
    failureType: 'hash_mismatch' | 'invalid_signature' | 'certificate_issue' | 'missing_signature' | 'malformed',
    options?: {
      expectedHash?: string;
      actualHash?: string;
      cause?: Error;
    }
  ) {
    super(SigningErrorCode.SIGNATURE_VERIFICATION_FAILED, message, {
      httpStatus: 400,
      retryable: false,
      context: {
        failureType,
        expectedHash: options?.expectedHash,
        actualHash: options?.actualHash
      },
      cause: options?.cause
    });
    this.name = 'SignatureVerificationError';
    this.failureType = failureType;
  }
}

/**
 * Error thrown when signing is disabled but required
 */
export class SigningDisabledError extends SigningError {
  constructor(message: string = 'Signing is disabled but v1.1 document was requested') {
    super(SigningErrorCode.SIGNING_DISABLED, message, {
      httpStatus: 400,
      retryable: false
    });
    this.name = 'SigningDisabledError';
  }
}

/**
 * Error thrown when signing is enabled but not properly configured
 */
export class SigningNotConfiguredError extends SigningError {
  constructor(message: string = 'Signing is enabled but certificate or private key is not configured') {
    super(SigningErrorCode.SIGNING_NOT_CONFIGURED, message, {
      httpStatus: 500,
      retryable: false
    });
    this.name = 'SigningNotConfiguredError';
  }
}

/**
 * Error thrown when invalid document version is specified
 */
export class InvalidDocumentVersionError extends SigningError {
  /** The invalid version that was provided */
  readonly providedVersion: string;

  constructor(providedVersion: string) {
    super(
      SigningErrorCode.INVALID_DOCUMENT_VERSION,
      `Invalid document version: ${providedVersion}. Must be '1.0' or '1.1'`,
      {
        httpStatus: 400,
        retryable: false,
        context: { providedVersion }
      }
    );
    this.name = 'InvalidDocumentVersionError';
    this.providedVersion = providedVersion;
  }
}

/**
 * Type guard to check if an error is a SigningError
 */
export function isSigningError(error: unknown): error is SigningError {
  return error instanceof SigningError;
}

/**
 * Get HTTP status code for a signing error
 */
export function getSigningErrorHttpStatus(error: SigningError): number {
  return error.httpStatus;
}
