/**
 * @myinvois/signing - Digital signature support for MyInvois v1.1 documents
 *
 * This package provides certificate management and document signing capabilities
 * for MyInvois e-invoices using X.509 certificates.
 */

// Package info
export const PACKAGE_NAME = '@myinvois/signing';
export const PACKAGE_VERSION = '0.1.0';

// Configuration
export {
  SigningConfigSchema,
  CertificateSourceSchema,
  PrivateKeySourceSchema,
  DocumentVersionSchema,
  RotationConfigSchema,
  loadSigningConfig,
  validateSigningConfig,
  SIGNING_ENV_VARS
} from './config.js';

export type {
  SigningConfig,
  CertificateSource,
  PrivateKeySource,
  RotationConfig
} from './config.js';

// Types
export type {
  DocumentVersion,
  DistinguishedName,
  CertificateInfo,
  SigningResult,
  SignatureBlock,
  VerificationResult,
  SigningOptions,
  SessionSigningConfig,
  SigningHealthStatus
} from './types.js';

// Errors
export {
  SigningErrorCode,
  SigningError,
  CertificateLoadError,
  PrivateKeyLoadError,
  CertificateExpiredError,
  CertificateNotYetValidError,
  KeyCertificateMismatchError,
  SignatureGenerationError,
  SignatureVerificationError,
  SigningDisabledError,
  SigningNotConfiguredError,
  InvalidDocumentVersionError,
  isSigningError,
  getSigningErrorHttpStatus
} from './errors.js';

// Placeholder exports - will be expanded in subsequent user stories
export function getPackageInfo(): { name: string; version: string } {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION
  };
}
