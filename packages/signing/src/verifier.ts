import * as crypto from "crypto";
import type { VerificationResult, CertificateInfo } from "./types.js";
import { generateDocumentHash, canonicalizeDocument } from "./hash.js";
import { parseCertificate } from "./certificate-loader.js";
import { SIGNATURE_URIS } from "./signer.js";

/**
 * Get UBLExtensions from a document element that could be either an object or array
 */
function getUBLExtensions(element: unknown): Record<string, unknown> | null {
  if (!element || typeof element !== "object") {
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
    if (ublExt && typeof ublExt === "object") {
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
  if (ublExt && typeof ublExt === "object") {
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
      signedInfo: null,
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
      signedInfo: null,
    };
  }

  const firstExtension = ublExtension[0];

  // Handle ExtensionContent - can be array (new format) or object (old format)
  let extensionContent: Record<string, unknown> | undefined;
  const extContentRaw = firstExtension.ExtensionContent;
  if (Array.isArray(extContentRaw) && extContentRaw.length > 0) {
    extensionContent = extContentRaw[0] as Record<string, unknown>;
  } else if (extContentRaw && typeof extContentRaw === "object") {
    extensionContent = extContentRaw as Record<string, unknown>;
  }

  if (!extensionContent) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null,
    };
  }

  // Handle UBLDocumentSignatures - can be array or object
  let docSignatures: Record<string, unknown> | undefined;
  const docSigsRaw = extensionContent.UBLDocumentSignatures;
  if (Array.isArray(docSigsRaw) && docSigsRaw.length > 0) {
    docSignatures = docSigsRaw[0] as Record<string, unknown>;
  } else if (docSigsRaw && typeof docSigsRaw === "object") {
    docSignatures = docSigsRaw as Record<string, unknown>;
  }

  if (!docSignatures) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null,
    };
  }

  // Handle SignatureInformation - can be array or object
  let sigInfo: Record<string, unknown> | undefined;
  const sigInfoRaw = docSignatures.SignatureInformation;
  if (Array.isArray(sigInfoRaw) && sigInfoRaw.length > 0) {
    sigInfo = sigInfoRaw[0] as Record<string, unknown>;
  } else if (sigInfoRaw && typeof sigInfoRaw === "object") {
    sigInfo = sigInfoRaw as Record<string, unknown>;
  }

  if (!sigInfo) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null,
    };
  }

  // Handle Signature - can be array or object
  let signature: Record<string, unknown> | undefined;
  const sigRaw = sigInfo.Signature;
  if (Array.isArray(sigRaw) && sigRaw.length > 0) {
    signature = sigRaw[0] as Record<string, unknown>;
  } else if (sigRaw && typeof sigRaw === "object") {
    signature = sigRaw as Record<string, unknown>;
  }

  if (!signature) {
    return {
      signatureBlock: null,
      digestValue: null,
      signatureValue: null,
      certificatePem: null,
      signedInfo: null,
    };
  }

  // Extract SignedInfo - can be array or object
  let signedInfo: Record<string, unknown> | undefined;
  const signedInfoRaw = signature.SignedInfo;
  if (Array.isArray(signedInfoRaw) && signedInfoRaw.length > 0) {
    signedInfo = signedInfoRaw[0] as Record<string, unknown>;
  } else if (signedInfoRaw && typeof signedInfoRaw === "object") {
    signedInfo = signedInfoRaw as Record<string, unknown>;
  }

  // Extract SignatureValue - handle both new array format [{Id, Value}] and old string format
  let signatureValue: string | null = null;
  const sigValRaw = signature.SignatureValue;
  if (Array.isArray(sigValRaw) && sigValRaw.length > 0) {
    const sigValObj = sigValRaw[0] as Record<string, unknown>;
    // New format: { Id: '...', Value: 'base64...' }
    if (sigValObj.Value) {
      signatureValue = sigValObj.Value as string;
    } else if (sigValObj._) {
      signatureValue = sigValObj._ as string;
    }
  } else if (typeof sigValRaw === "string") {
    signatureValue = sigValRaw;
  }

  // Extract KeyInfo - can be array or object
  let keyInfo: Record<string, unknown> | undefined;
  const keyInfoRaw = signature.KeyInfo;
  if (Array.isArray(keyInfoRaw) && keyInfoRaw.length > 0) {
    keyInfo = keyInfoRaw[0] as Record<string, unknown>;
  } else if (keyInfoRaw && typeof keyInfoRaw === "object") {
    keyInfo = keyInfoRaw as Record<string, unknown>;
  }

  // Extract digest value from SignedInfo
  let digestValue: string | null = null;
  if (signedInfo) {
    const referenceRaw = signedInfo.Reference;
    // Handle array of references (new format per official LHDN sample)
    // Reference[0] = SignedProperties digest (Type = http://uri.etsi.org/01903/v1.3.2#SignedProperties)
    // Reference[1] = Document digest (Type = "" or missing, URI = "")
    if (Array.isArray(referenceRaw) && referenceRaw.length > 0) {
      // Find the document reference (Type is empty string or missing, URI is empty)
      let reference = referenceRaw[0] as Record<string, unknown>;

      // If first reference is SignedProperties, use the second one for document digest
      if (referenceRaw.length > 1) {
        const firstType = (reference.Type as string) || "";
        if (firstType.includes("SignedProperties")) {
          reference = referenceRaw[1] as Record<string, unknown>;
        }
      }

      const digestValRaw = reference.DigestValue;
      if (Array.isArray(digestValRaw) && digestValRaw.length > 0) {
        const digestObj = digestValRaw[0] as Record<string, unknown>;
        digestValue = (digestObj._ as string) || null;
      } else if (typeof digestValRaw === "string") {
        digestValue = digestValRaw;
      }
    } else if (referenceRaw && typeof referenceRaw === "object") {
      // Old format: single Reference object
      const reference = referenceRaw as Record<string, unknown>;
      const digestValRaw = reference.DigestValue;
      if (Array.isArray(digestValRaw) && digestValRaw.length > 0) {
        const digestObj = digestValRaw[0] as Record<string, unknown>;
        digestValue = (digestObj._ as string) || null;
      } else if (typeof digestValRaw === "string") {
        digestValue = digestValRaw;
      }
    }
  }

  // Extract certificate PEM from KeyInfo
  let certificatePem: string | null = null;
  if (keyInfo) {
    const x509DataRaw = keyInfo.X509Data;
    let x509Data: Record<string, unknown> | undefined;
    if (Array.isArray(x509DataRaw) && x509DataRaw.length > 0) {
      x509Data = x509DataRaw[0] as Record<string, unknown>;
    } else if (x509DataRaw && typeof x509DataRaw === "object") {
      x509Data = x509DataRaw as Record<string, unknown>;
    }

    if (x509Data) {
      const certRaw = x509Data.X509Certificate;
      let certContent: string | undefined;
      if (Array.isArray(certRaw) && certRaw.length > 0) {
        const certObj = certRaw[0] as Record<string, unknown>;
        certContent = certObj._ as string;
      } else if (typeof certRaw === "string") {
        certContent = certRaw;
      }

      if (certContent) {
        // Add PEM headers
        certificatePem = `-----BEGIN CERTIFICATE-----\n${certContent}\n-----END CERTIFICATE-----`;
      }
    }
  }

  return {
    signatureBlock: signature,
    digestValue,
    signatureValue,
    certificatePem,
    signedInfo: signedInfo || null,
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
 * Remove signature elements from a document element
 * Both UBLExtensions and Signature must be removed for hash recalculation
 */
function removeSignatureElementsFromElement(element: unknown): unknown {
  if (!element || typeof element !== "object") {
    return element;
  }

  // Handle array-wrapped documents (MyInvois format: Invoice: [{UBLExtensions: [...], ...}])
  if (Array.isArray(element)) {
    return element.map((item, index) => {
      if (index === 0 && typeof item === "object" && item !== null) {
        const obj = { ...(item as Record<string, unknown>) };
        delete obj.UBLExtensions;
        delete obj.Signature;
        return obj;
      }
      return item;
    });
  }

  // Handle object-wrapped documents (simple format: Invoice: {UBLExtensions: {...}, ...})
  const obj = { ...(element as Record<string, unknown>) };
  delete obj.UBLExtensions;
  delete obj.Signature;
  return obj;
}

/**
 * Remove signature elements from document
 */
function removeUBLExtensions(document: Record<string, unknown>): Record<string, unknown> {
  const result = { ...document };

  if (result.Invoice) {
    result.Invoice = removeSignatureElementsFromElement(result.Invoice);
    return result;
  }

  if (result.CreditNote) {
    result.CreditNote = removeSignatureElementsFromElement(result.CreditNote);
    return result;
  }

  if (result.DebitNote) {
    result.DebitNote = removeSignatureElementsFromElement(result.DebitNote);
    return result;
  }

  if (result.UBLExtensions) {
    delete result.UBLExtensions;
  }
  if (result.Signature) {
    delete result.Signature;
  }

  return result;
}

/**
 * Verify cryptographic signature
 * Note: MyInvois signs the canonicalized document (not SignedInfo)
 */
function verifySignature(
  document: Record<string, unknown>,
  signatureValue: string,
  publicKey: crypto.KeyObject
): boolean {
  try {
    // MyInvois signs the canonicalized document bytes (without UBLExtensions)
    const docBytes = canonicalizeDocument(document);
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(docBytes, "utf8");
    return verify.verify(publicKey, signatureValue, "base64");
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
    errors.push("Missing signature block");
    return {
      valid: false,
      document: {
        hashValid: false,
        computedHash: "",
        claimedHash: "",
      },
      signature: {
        valid: false,
        algorithm: SIGNATURE_URIS.SIGNATURE_METHOD,
      },
      certificate: {
        valid: false,
        issuer: "",
        subject: "",
        expiresAt: new Date(0),
        isExpired: true,
      },
      errors,
    };
  }

  // Check digest value
  if (!extracted.digestValue) {
    errors.push("Missing digest value in signature");
  }

  // Check signature value
  if (!extracted.signatureValue) {
    errors.push("Missing signature value");
  }

  // Check certificate
  if (!extracted.certificatePem) {
    errors.push("Missing certificate in signature");
  }

  // Check signed info
  if (!extracted.signedInfo) {
    errors.push("Missing SignedInfo in signature");
  }

  // If we're missing critical components, return early
  if (errors.length > 0) {
    return {
      valid: false,
      document: {
        hashValid: false,
        computedHash: "",
        claimedHash: extracted.digestValue || "",
      },
      signature: {
        valid: false,
        algorithm: SIGNATURE_URIS.SIGNATURE_METHOD,
      },
      certificate: {
        valid: false,
        issuer: "",
        subject: "",
        expiresAt: new Date(0),
        isExpired: true,
      },
      errors,
    };
  }

  // Recalculate document hash
  const computedHash = recalculateHash(document);
  const hashValid = computedHash === extracted.digestValue;

  if (!hashValid) {
    errors.push("Document hash mismatch - document may have been tampered");
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
        claimedHash: extracted.digestValue!,
      },
      signature: {
        valid: false,
        algorithm: SIGNATURE_URIS.SIGNATURE_METHOD,
      },
      certificate: {
        valid: false,
        issuer: "",
        subject: "",
        expiresAt: new Date(0),
        isExpired: true,
      },
      errors,
    };
  }

  // Check certificate validity
  if (certInfo.isExpired) {
    errors.push("Certificate has expired");
  }

  if (certInfo.isNotYetValid) {
    errors.push("Certificate is not yet valid");
  }

  // Verify cryptographic signature (MyInvois signs the canonicalized document)
  const signatureValid = verifySignature(document, extracted.signatureValue!, publicKey);

  if (!signatureValid) {
    errors.push("Invalid cryptographic signature");
  }

  return {
    valid: errors.length === 0,
    document: {
      hashValid,
      computedHash,
      claimedHash: extracted.digestValue!,
    },
    signature: {
      valid: signatureValid,
      algorithm: SIGNATURE_URIS.SIGNATURE_METHOD,
    },
    certificate: {
      valid: certInfo.isValid,
      issuer: certInfo.issuer.raw,
      subject: certInfo.subject.raw,
      expiresAt: certInfo.validTo,
      isExpired: certInfo.isExpired,
    },
    errors,
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
