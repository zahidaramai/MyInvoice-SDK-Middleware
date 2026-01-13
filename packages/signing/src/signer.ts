import * as crypto from 'crypto';
import type { KeyObject } from 'crypto';
import type { CertificateInfo, SignatureBlock, SigningResult } from './types.js';
import { generateDocumentHash } from './hash.js';
import { SignatureGenerationError } from './errors.js';

/**
 * UBL Signature URIs
 */
export const SIGNATURE_URIS = {
  EXTENSION_URI: 'urn:oasis:names:specification:ubl:dsig:enveloped:xades',
  SIGNATURE_ID: 'urn:oasis:names:specification:ubl:signature:1',
  REFERENCED_SIGNATURE_ID: 'urn:oasis:names:specification:ubl:signature:Invoice',
  SIGNATURE_METHOD: 'urn:oasis:names:specification:ubl:dsig:enveloped:xades',
  DIGEST_METHOD: 'http://www.w3.org/2001/04/xmlenc#sha256',
  TRANSFORM: 'urn:oasis:names:specification:ubl:dsig:enveloped'
} as const;

/**
 * Create the SignedInfo structure for signing
 */
function createSignedInfo(digestValue: string): Record<string, unknown> {
  return {
    SignatureMethod: SIGNATURE_URIS.SIGNATURE_METHOD,
    Reference: {
      DigestMethod: SIGNATURE_URIS.DIGEST_METHOD,
      DigestValue: digestValue,
      Transforms: {
        Transform: SIGNATURE_URIS.TRANSFORM
      }
    }
  };
}

/**
 * Generate RSA-SHA256 signature of data
 */
function signData(data: string, privateKey: KeyObject): string {
  try {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data, 'utf8');
    return sign.sign(privateKey, 'base64');
  } catch (error) {
    throw new SignatureGenerationError(
      'Failed to generate RSA-SHA256 signature',
      { cause: error as Error }
    );
  }
}

/**
 * Create the KeyInfo structure with certificate details
 */
function createKeyInfo(
  certPem: string,
  certInfo: CertificateInfo
): Record<string, unknown> {
  // Extract certificate content without headers
  const certContent = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  return {
    X509Data: {
      X509Certificate: certContent,
      X509SubjectName: certInfo.subject.raw,
      X509IssuerSerial: {
        X509IssuerName: certInfo.issuer.raw,
        X509SerialNumber: certInfo.serialNumber
      }
    }
  };
}

/**
 * Create the QualifyingProperties structure
 */
function createQualifyingProperties(signingTime: Date): Record<string, unknown> {
  return {
    QualifyingProperties: {
      SignedProperties: {
        SignedSignatureProperties: {
          SigningTime: signingTime.toISOString()
        },
        SignedDataObjectProperties: {
          DataObjectFormat: {
            MimeType: 'text/json'
          }
        }
      }
    }
  };
}

/**
 * Create the complete signature block
 */
export function createSignatureBlock(
  digestValue: string,
  signatureValue: string,
  certPem: string,
  certInfo: CertificateInfo,
  signingTime: Date = new Date()
): SignatureBlock {
  const signedInfo = createSignedInfo(digestValue);
  const keyInfo = createKeyInfo(certPem, certInfo);
  const qualifyingProperties = createQualifyingProperties(signingTime);

  return {
    signatureMethod: SIGNATURE_URIS.SIGNATURE_METHOD,
    signatureValue,
    digestMethod: SIGNATURE_URIS.DIGEST_METHOD,
    digestValue,
    certificateInfo: {
      issuer: certInfo.issuer.raw,
      serialNumber: certInfo.serialNumber,
      subject: certInfo.subject.raw
    },
    signingTime: signingTime.toISOString(),
    _raw: {
      Id: 'signature',
      SignedInfo: signedInfo,
      SignatureValue: signatureValue,
      KeyInfo: keyInfo,
      Object: qualifyingProperties
    }
  };
}

/**
 * Create UBL Extensions structure with signature
 */
export function createUBLExtensions(signatureBlock: SignatureBlock): Record<string, unknown> {
  return {
    UBLExtension: [
      {
        ExtensionURI: SIGNATURE_URIS.EXTENSION_URI,
        ExtensionContent: {
          UBLDocumentSignatures: {
            SignatureInformation: {
              ID: SIGNATURE_URIS.SIGNATURE_ID,
              ReferencedSignatureID: SIGNATURE_URIS.REFERENCED_SIGNATURE_ID,
              Signature: signatureBlock._raw
            }
          }
        }
      }
    ]
  };
}

/**
 * Inject signature into document
 * Places the UBLExtensions at the beginning of the document wrapper
 */
export function injectSignature(
  document: Record<string, unknown>,
  signatureBlock: SignatureBlock
): Record<string, unknown> {
  const extensions = createUBLExtensions(signatureBlock);

  // Determine document type
  if (document.Invoice && typeof document.Invoice === 'object') {
    return {
      Invoice: {
        UBLExtensions: extensions,
        ...(document.Invoice as Record<string, unknown>)
      }
    };
  }

  if (document.CreditNote && typeof document.CreditNote === 'object') {
    return {
      CreditNote: {
        UBLExtensions: extensions,
        ...(document.CreditNote as Record<string, unknown>)
      }
    };
  }

  if (document.DebitNote && typeof document.DebitNote === 'object') {
    return {
      DebitNote: {
        UBLExtensions: extensions,
        ...(document.DebitNote as Record<string, unknown>)
      }
    };
  }

  // Handle unwrapped document
  return {
    UBLExtensions: extensions,
    ...document
  };
}

/**
 * Sign a document using RSA-SHA256
 *
 * @param document - The document to sign
 * @param privateKey - The private key for signing
 * @param certPem - The certificate PEM content
 * @param certInfo - Parsed certificate information
 * @param signingTime - Optional signing time (defaults to now)
 * @returns Signing result with signed document and metadata
 */
export function sign(
  document: Record<string, unknown>,
  privateKey: KeyObject,
  certPem: string,
  certInfo: CertificateInfo,
  signingTime: Date = new Date()
): SigningResult {
  // Step 1: Generate document hash
  const digestValue = generateDocumentHash(document);

  // Step 2: Create SignedInfo and sign it
  const signedInfo = createSignedInfo(digestValue);
  const signedInfoJson = JSON.stringify(signedInfo);
  const signatureValue = signData(signedInfoJson, privateKey);

  // Step 3: Create signature block
  const signatureBlock = createSignatureBlock(
    digestValue,
    signatureValue,
    certPem,
    certInfo,
    signingTime
  );

  // Step 4: Inject signature into document
  const signedDocument = injectSignature(document, signatureBlock);

  return {
    signedDocument,
    signatureBlock,
    documentHash: digestValue,
    signedAt: signingTime
  };
}

/**
 * SigningService class for managing document signing
 */
export class SigningService {
  private privateKey: KeyObject;
  private certPem: string;
  private certInfo: CertificateInfo;

  constructor(
    privateKey: KeyObject,
    certPem: string,
    certInfo: CertificateInfo
  ) {
    this.privateKey = privateKey;
    this.certPem = certPem;
    this.certInfo = certInfo;
  }

  /**
   * Sign a document
   */
  sign(
    document: Record<string, unknown>,
    signingTime: Date = new Date()
  ): SigningResult {
    return sign(
      document,
      this.privateKey,
      this.certPem,
      this.certInfo,
      signingTime
    );
  }

  /**
   * Get certificate info
   */
  getCertificateInfo(): CertificateInfo {
    return this.certInfo;
  }

  /**
   * Check if certificate is still valid
   */
  isCertificateValid(): boolean {
    return this.certInfo.isValid;
  }

  /**
   * Get days until certificate expires
   */
  getDaysUntilExpiry(): number {
    return this.certInfo.daysUntilExpiry;
  }
}
