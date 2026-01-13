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
  PKCS12SourceSchema,
  loadSigningConfig,
  validateSigningConfig,
  SIGNING_ENV_VARS
} from './config.js';

export type {
  SigningConfig,
  CertificateSource,
  PrivateKeySource,
  RotationConfig,
  PKCS12Source
} from './config.js';

// PKCS#12 Loader
export {
  loadPKCS12,
  loadPKCS12FromFile,
  loadPKCS12FromBase64,
  isPKCS12File
} from './pkcs12-loader.js';

export type { PKCS12Result } from './pkcs12-loader.js';

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

// Certificate Loader
export {
  loadCertificate,
  loadAndValidateCertificate,
  loadCertificatePem,
  loadCertificateFromFile,
  loadCertificateFromBase64,
  loadCertificateFromEnv,
  parseCertificate,
  validateCertificate,
  getX509Certificate
} from './certificate-loader.js';

// Private Key Loader
export {
  loadPrivateKey,
  loadAndVerifyPrivateKey,
  loadPrivateKeyPem,
  loadPrivateKeyFromFile,
  loadPrivateKeyFromBase64,
  loadPrivateKeyFromEnv,
  parsePrivateKey,
  verifyKeyMatchesCertificate,
  getPrivateKeyInfo
} from './private-key-loader.js';

export type { PrivateKeyInfo } from './private-key-loader.js';

// Hash Generation
export {
  canonicalizeDocument,
  generateDocumentHash,
  generateDocumentHashHex,
  hashString,
  verifyDocumentHash
} from './hash.js';

// Document Signer
export {
  sign,
  SigningService,
  createSignatureBlock,
  createUBLExtensions,
  injectSignature,
  SIGNATURE_URIS
} from './signer.js';

// Signature Verifier
export {
  verify,
  VerificationService,
  extractSignature,
  recalculateHash
} from './verifier.js';

// Placeholder exports - will be expanded in subsequent user stories
export function getPackageInfo(): { name: string; version: string } {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION
  };
}
