import * as crypto from 'crypto';
import type { VerificationResult, CertificateInfo } from './types.js';
import { generateDocumentHash } from './hash.js';
import { parseCertificate } from './certificate-loader.js';
import { SIGNATURE_URIS } from './signer.js';

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

  if (document.Invoice && typeof document.Invoice === 'object') {
    const invoice = document.Invoice as Record<string, unknown>;
    if (invoice.UBLExtensions) {
      extensions = invoice.UBLExtensions as Record<string, unknown>;
    }
  } else if (document.CreditNote && typeof document.CreditNote === 'object') {
    const creditNote = document.CreditNote as Record<string, unknown>;
    if (creditNote.UBLExtensions) {
      extensions = creditNote.UBLExtensions as Record<string, unknown>;
    }
  } else if (document.DebitNote && typeof document.DebitNote === 'object') {
    const debitNote = document.DebitNote as Record<string, unknown>;
    if (debitNote.UBLExtensions) {
      extensions = debitNote.UBLExtensions as Record<string, unknown>;
    }
  } else if (document.UBLExtensions) {
    extensions = document.UBLExtensions as Record<string, unknown>;
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
 * Remove UBLExtensions from document
 */
function removeUBLExtensions(document: Record<string, unknown>): Record<string, unknown> {
  const result = { ...document };

  if (result.Invoice && typeof result.Invoice === 'object') {
    const invoice = { ...(result.Invoice as Record<string, unknown>) };
    delete invoice.UBLExtensions;
    result.Invoice = invoice;
    return result;
  }

  if (result.CreditNote && typeof result.CreditNote === 'object') {
    const creditNote = { ...(result.CreditNote as Record<string, unknown>) };
    delete creditNote.UBLExtensions;
    result.CreditNote = creditNote;
    return result;
  }

  if (result.DebitNote && typeof result.DebitNote === 'object') {
    const debitNote = { ...(result.DebitNote as Record<string, unknown>) };
    delete debitNote.UBLExtensions;
    result.DebitNote = debitNote;
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
