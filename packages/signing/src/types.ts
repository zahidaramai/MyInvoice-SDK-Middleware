/**
 * Core type definitions for the @myinvois/signing package
 */

/**
 * Document version types supported by MyInvois
 * - '1.0': Unsigned documents (legacy)
 * - '1.1': Digitally signed documents
 */
export type DocumentVersion = "1.0" | "1.1";

/**
 * Certificate subject/issuer distinguished name components
 */
export interface DistinguishedName {
  /** Common Name (CN) */
  commonName?: string;
  /** Organization (O) */
  organization?: string;
  /** Organizational Unit (OU) */
  organizationalUnit?: string;
  /** Country (C) */
  country?: string;
  /** State/Province (ST) */
  state?: string;
  /** Locality (L) */
  locality?: string;
  /** Email address */
  emailAddress?: string;
  /** Raw distinguished name string */
  raw: string;
}

/**
 * Information extracted from an X.509 certificate
 */
export interface CertificateInfo {
  /** Certificate subject distinguished name */
  subject: DistinguishedName;
  /** Certificate issuer distinguished name */
  issuer: DistinguishedName;
  /** Certificate serial number (hex string) */
  serialNumber: string;
  /** Certificate validity start date */
  validFrom: Date;
  /** Certificate validity end date */
  validTo: Date;
  /** Whether the certificate is currently valid (within validity period) */
  isValid: boolean;
  /** Whether the certificate has expired */
  isExpired: boolean;
  /** Whether the certificate is not yet valid */
  isNotYetValid: boolean;
  /** Days until expiry (negative if expired) */
  daysUntilExpiry: number;
  /** Certificate fingerprint (SHA-256) */
  fingerprint: string;
  /** Key type (RSA, EC, etc.) */
  keyType: string;
  /** Key size in bits */
  keySize: number;
  /** Key usage extensions */
  keyUsage?: string[];
  /** Extended key usage */
  extendedKeyUsage?: string[];
}

/**
 * Result of a document signing operation
 */
export interface SigningResult {
  /** The signed document with signature block injected */
  signedDocument: Record<string, unknown>;
  /** The signature block that was injected */
  signatureBlock: SignatureBlock;
  /** Timestamp when signing occurred */
  signedAt: Date;
  /** Document hash (SHA-256, base64 encoded) */
  documentHash: string;
}

/**
 * Signature block structure per LHDN/MyInvois specification
 */
export interface SignatureBlock {
  /** Signature algorithm method URI */
  signatureMethod: string;
  /** Base64-encoded signature value */
  signatureValue: string;
  /** Digest/hash algorithm method URI */
  digestMethod: string;
  /** Base64-encoded digest value */
  digestValue: string;
  /** Certificate information included in signature */
  certificateInfo: {
    /** Certificate issuer distinguished name */
    issuer: string;
    /** Certificate serial number */
    serialNumber: string;
    /** Certificate subject distinguished name */
    subject: string;
  };
  /** ISO 8601 timestamp when signature was created */
  signingTime: string;
  /** Raw UBL signature structure for document injection */
  _raw: Record<string, unknown>;
}

/**
 * Result of a signature verification operation
 */
export interface VerificationResult {
  /** Overall verification result */
  valid: boolean;
  /** Document hash verification details */
  document: {
    /** Whether the document hash is valid */
    hashValid: boolean;
    /** Computed hash of the document */
    computedHash: string;
    /** Hash claimed in the signature */
    claimedHash: string;
  };
  /** Signature verification details */
  signature: {
    /** Whether the signature is cryptographically valid */
    valid: boolean;
    /** Algorithm used for signing */
    algorithm: string;
  };
  /** Certificate verification details */
  certificate: {
    /** Whether the certificate is valid */
    valid: boolean;
    /** Certificate issuer */
    issuer: string;
    /** Certificate subject */
    subject: string;
    /** Certificate expiry date */
    expiresAt: Date;
    /** Whether the certificate has expired */
    isExpired: boolean;
  };
  /** List of validation errors (empty if valid) */
  errors: string[];
}

/**
 * Options for signing a document
 */
export interface SigningOptions {
  /** Document version to use */
  version?: DocumentVersion;
  /** Custom signing time (defaults to now) */
  signingTime?: Date;
  /** Include certificate chain in signature */
  includeCertificateChain?: boolean;
}

/**
 * Session-level signing configuration
 */
export interface SessionSigningConfig {
  /** Document version for this session */
  documentVersion: DocumentVersion;
  /** Whether signing is enabled for this session */
  signingEnabled: boolean;
}

/**
 * Signing health status for monitoring
 */
export interface SigningHealthStatus {
  /** Whether signing feature is enabled */
  enabled: boolean;
  /** Whether the certificate is valid */
  certificateValid: boolean;
  /** Certificate expiry date (if available) */
  certificateExpiry?: string;
  /** Default document version */
  defaultVersion: DocumentVersion;
  /** Warning message (e.g., certificate expiring soon) */
  warning?: string;
}
