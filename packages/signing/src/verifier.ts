import * as crypto from 'crypto';
import type { VerificationResult, CertificateInfo } from './types.js';
import { generateDocumentHash } from './hash.js';
import { parseCertificate } from './certificate-loader.js';
import { SIGNATURE_URIS } from './signer.js';

/**
 * Get UBLExtensions from a document element that could be either an object or array
 */
function getUBLExtensions(element: unknown): Record<string, unknown> | null {
  if (!element || typeof element !== 'object') {
    return null;
  }

  // Handle array-wrapped documents (MyInvois format: Invoice: [{UBLExtensions: [...], ...}])
  if (Array.isArray(element) && element.length > 0) {
    const firstElement = element[0] as Record<string, unknown>;
    const ublExt = firstElement.UBLExtensions;
    // UBLExtensions can be an array or object
    if (Array.isArray(ublExt) && ublExt.length > 0) {
      return ublExt[0] as Record<string, unknown>;
    }
    if (ublExt && typeof ublExt === 'object') {
      return ublExt as Record<string, unknown>;
    }
    return null;
  }

  // Handle object-wrapped documents (simple format: Invoice: {UBLExtensions: {...}, ...})
  const obj = element as Record<string, unknown>;
  const ublExt = obj.UBLExtensions;
  if (Array.isArray(ublExt) && ublExt.length > 0) {
    return ublExt[0] as Record<string, unknown>;
  }
  if (ublExt && typeof ublExt === 'object') {
    return ublExt as Record<string, unknown>;
  }
  return null;
}

/**
 * Extract signature block from a signed document
 */
export function extractSignature(document: Record<string, unknown>): {
  signatureBlock: Record<string, unknown> | null;
  digestValue: string | null;
  signatureValue: string | null;
  certificatePem: string | null;
  signedInfo: Record<string, unknown> | null;
} {
  // Find UBLExtensions
  let extensions: Record<string, unknown> | null = null;

  if (document.Invoice) {
    extensions = getUBLExtensions(document.Invoice);
  } else if (document.CreditNote) {
    extensions = getUBLExtensions(document.CreditNote);
  } else if (document.DebitNote) {
    extensions = getUBLExtensions(document.DebitNote);
  } else if (document.UBLExtensions) {
    // Handle array of UBLExtensions
    if (Array.isArray(document.UBLExtensions) && document.UBLExtensions.length > 0) {
      extensions = document.UBLExtensions[0] as Record<string, unknown>;
    } else {
      extensions = document.UBLExtensions as Record<string, unknown>;
    }
  }

  if (!extensions) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null
    };
  }

  // Navigate through UBL structure
  const ublExtension = extensions.UBLExtension as Array<Record<string, unknown>> | undefined;
  if (!ublExtension || !Array.isArray(ublExtension) || ublExtension.length === 0) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null
    };
  }

  const firstExtension = ublExtension[0];
  const extensionContent = firstExtension.ExtensionContent as Record<string, unknown> | undefined;
  if (!extensionContent) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null
    };
  }

  const docSignatures = extensionContent.UBLDocumentSignatures as Record<string, unknown> | undefined;
  if (!docSignatures) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null
    };
  }

  const sigInfo = docSignatures.SignatureInformation as Record<string, unknown> | undefined;
  if (!sigInfo) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null
    };
  }

  const signature = sigInfo.Signature as Record<string, unknown> | undefined;
  if (!signature) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null
    };
  }

  // Extract components
  const signedInfo = signature.SignedInfo as Record<string, unknown> | undefined;
  const signatureValue = signature.SignatureValue as string | undefined;
  const keyInfo = signature.KeyInfo as Record<string, unknown> | undefined;

  let digestValue: string | null = null;
  if (signedInfo) {
    const reference = signedInfo.Reference as Record<string, unknown> | undefined;
    if (reference) {
      digestValue = reference.DigestValue as string || null;
    }
  }

  let certificatePem: string | null = null;
  if (keyInfo) {
    const x509Data = keyInfo.X509Data as Record<string, unknown> | undefined;
    if (x509Data) {
      const certContent = x509Data.X509Certificate as string | undefined;
      if (certContent) {
        // Add PEM headers
        certificatePem = `-----BEGIN CERTIFICATE-----\n${certContent}\n-----END CERTIFICATE-----`;
      }
    }
  }

  return {
    signatureBlock: signature,
    digestValue,
    signatureValue: signatureValue || null,
    certificatePem,
    signedInfo: signedInfo || null
  };
}

/**
 * Recalculate document hash (without signature)
 */
export function recalculateHash(document: Record<string, unknown>): string {
  // Remove UBLExtensions for hashing
  const docWithoutSig = removeUBLExtensions(document);
  return generateDocumentHash(docWithoutSig);
}

/**
 * Remove UBLExtensions from a document element
 */
function removeUBLExtensionsFromElement(element: unknown): unknown {
  if (!element || typeof element !== 'object') {
    return element;
  }

  // Handle array-wrapped documents (MyInvois format: Invoice: [{UBLExtensions: [...], ...}])
  if (Array.isArray(element)) {
    return element.map((item, index) => {
      if (index === 0 && typeof item === 'object' && item !== null) {
        const obj = { ...(item as Record<string, unknown>) };
        delete obj.UBLExtensions;
        return obj;
      }
      return item;
    });
  }

  // Handle object-wrapped documents (simple format: Invoice: {UBLExtensions: {...}, ...})
  const obj = { ...(element as Record<string, unknown>) };
  delete obj.UBLExtensions;
  return obj;
}

/**
 * Remove UBLExtensions from document
 */
function removeUBLExtensions(document: Record<string, unknown>): Record<string, unknown> {
  const result = { ...document };

  if (result.Invoice) {
    result.Invoice = removeUBLExtensionsFromElement(result.Invoice);
    return result;
  }

  if (result.CreditNote) {
    result.CreditNote = removeUBLExtensionsFromElement(result.CreditNote);
    return result;
  }

  if (result.DebitNote) {
    result.DebitNote = removeUBLExtensionsFromElement(result.DebitNote);
    return result;
  }

  if (result.UBLExtensions) {
    delete result.UBLExtensions;
  }

  return result;
}

/**
 * Verify cryptographic signature
 */
function verifySignature(
  signedInfo: Record<string, unknown>,
  signatureValue: string,
  publicKey: crypto.KeyObject
): boolean {
  try {
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(JSON.stringify(signedInfo), 'utf8');
    return verify.verify(publicKey, signatureValue, 'base64');
  } catch {
    return false;
  }
}

/**
 * Verify a signed document
 */
export function verify(document: Record<string, unknown>): VerificationResult {
  const errors: string[] = [];

  // Extract signature components
  const extracted = extractSignature(document);

  // Check if signature block exists
  if (!extracted.signatureBlock) {
    errors.push('Missing signature block');
    return {
      valid: false,
      document: {
        hashValid: false,
        computedHash: '',
        claimedHash: ''
      },
      signature: {
        valid: false,
        algorithm: SIGNATURE_URIS.SIGNATURE_METHOD
      },
      certificate: {
        valid: false,
        issuer: '',
        subject: '',
        expiresAt: new Date(0),
        isExpired: true
      },
      errors
    };
  }

  // Check digest value
  if (!extracted.digestValue) {
    errors.push('Missing digest value in signature');
  }

  // Check signature value
  if (!extracted.signatureValue) {
    errors.push('Missing signature value');
  }

  // Check certificate
  if (!extracted.certificatePem) {
    errors.push('Missing certificate in signature');
  }

  // Check signed info
  if (!extracted.signedInfo) {
    errors.push('Missing SignedInfo in signature');
  }

  // If we're missing critical components, return early
  if (errors.length > 0) {
    return {
      valid: false,
      document: {
        hashValid: false,
        computedHash: '',
        claimedHash: extracted.digestValue || ''
      },
      signature: {
        valid: false,
        algorithm: SIGNATURE_URIS.SIGNATURE_METHOD
      },
      certificate: {
        valid: false,
        issuer: '',
        subject: '',
        expiresAt: new Date(0),
        isExpired: true
      },
      errors
    };
  }

  // Recalculate document hash
  const computedHash = recalculateHash(document);
  const hashValid = computedHash === extracted.digestValue;

  if (!hashValid) {
    errors.push('Document hash mismatch - document may have been tampered');
  }

  // Parse certificate
  let certInfo: CertificateInfo;
  let publicKey: crypto.KeyObject;

  try {
    certInfo = parseCertificate(extracted.certificatePem!);
    const cert = new crypto.X509Certificate(extracted.certificatePem!);
    publicKey = cert.publicKey;
  } catch (error) {
    errors.push(`Invalid certificate: ${(error as Error).message}`);
    return {
      valid: false,
      document: {
        hashValid,
        computedHash,
        claimedHash: extracted.digestValue!
      },
      signature: {
        valid: false,
        algorithm: SIGNATURE_URIS.SIGNATURE_METHOD
      },
      certificate: {
        valid: false,
        issuer: '',
        subject: '',
        expiresAt: new Date(0),
        isExpired: true
      },
      errors
    };
  }

  // Check certificate validity
  if (certInfo.isExpired) {
    errors.push('Certificate has expired');
  }

  if (certInfo.isNotYetValid) {
    errors.push('Certificate is not yet valid');
  }

  // Verify cryptographic signature
  const signatureValid = verifySignature(
    extracted.signedInfo!,
    extracted.signatureValue!,
    publicKey
  );

  if (!signatureValid) {
    errors.push('Invalid cryptographic signature');
  }

  return {
    valid: errors.length === 0,
    document: {
      hashValid,
      computedHash,
      claimedHash: extracted.digestValue!
    },
    signature: {
      valid: signatureValid,
      algorithm: SIGNATURE_URIS.SIGNATURE_METHOD
    },
    certificate: {
      valid: certInfo.isValid,
      issuer: certInfo.issuer.raw,
      subject: certInfo.subject.raw,
      expiresAt: certInfo.validTo,
      isExpired: certInfo.isExpired
    },
    errors
  };
}

/**
 * VerificationService class for verifying signed documents
 */
export class VerificationService {
  /**
   * Verify a signed document
   */
  verify(document: Record<string, unknown>): VerificationResult {
    return verify(document);
  }

  /**
   * Extract and return the signature block from a document
   */
  extractSignature(document: Record<string, unknown>) {
    return extractSignature(document);
  }

  /**
   * Check if a document has a signature
   */
  hasSignature(document: Record<string, unknown>): boolean {
    const extracted = extractSignature(document);
    return extracted.signatureBlock !== null;
  }

  /**
   * Get the document hash from a signed document
   */
  getClaimedHash(document: Record<string, unknown>): string | null {
    const extracted = extractSignature(document);
    return extracted.digestValue;
  }

  /**
   * Recalculate the document hash
   */
  recalculateHash(document: Record<string, unknown>): string {
    return recalculateHash(document);
  }
}
