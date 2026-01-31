import * as crypto from 'crypto';
import type { KeyObject } from 'crypto';
import type { CertificateInfo, SignatureBlock, SigningResult } from './types.js';
import { generateDocumentHash, canonicalizeDocument } from './hash.js';
import { SignatureGenerationError } from './errors.js';

/**
 * Format a date as ISO string without milliseconds
 * Official LHDN format: "2025-04-15T01:58:17Z" (no milliseconds)
 */
function formatSigningTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

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
 * Create the SignedInfo structure in MyInvois UBL JSON array format
 */
function createSignedInfoUBL(digestValue: string, propsDigest: string, _timestamp: string): unknown[] {
  // Match official LHDN sample structure:
  // - SignedProperties reference FIRST, document reference SECOND
  // - No Id fields in references
  // - Type comes before URI in each reference
  return [
    {
      SignatureMethod: [
        {
          _: '',
          Algorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
        }
      ],
      Reference: [
        // First reference: SignedProperties (per official sample)
        {
          Type: 'http://uri.etsi.org/01903/v1.3.2#SignedProperties',
          URI: '#id-xades-signed-props',
          DigestMethod: [
            {
              _: '',
              Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256'
            }
          ],
          DigestValue: [{ _: propsDigest }]
        },
        // Second reference: Document (per official sample)
        {
          Type: '',
          URI: '',
          DigestMethod: [
            {
              _: '',
              Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256'
            }
          ],
          DigestValue: [{ _: digestValue }]
        }
      ]
    }
  ];
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
 * Create the KeyInfo structure in MyInvois UBL JSON array format
 */
function createKeyInfoUBL(
  certPem: string,
  certInfo: CertificateInfo
): unknown[] {
  // Extract certificate content without headers
  const certContent = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  return [
    {
      X509Data: [
        {
          X509Certificate: [{ _: certContent }],
          X509SubjectName: [{ _: certInfo.subject.raw }],
          X509IssuerSerial: [
            {
              X509IssuerName: [{ _: certInfo.issuer.raw }],
              X509SerialNumber: [{ _: certInfo.serialNumber }]
            }
          ]
        }
      ]
    }
  ];
}

/**
 * Create the QualifyingProperties structure in MyInvois UBL JSON array format
 * Per official LHDN sample, this uses QualifyingProperties (not XadesQualifyingProperties)
 */
function createQualifyingPropertiesUBL(
  signingTime: Date,
  certDigestBase64: string,
  certInfo: CertificateInfo,
  _timestamp: string
): unknown[] {
  return [
    {
      Target: 'signature',
      SignedProperties: [
        {
          Id: 'id-xades-signed-props',
          SignedSignatureProperties: [
            {
              SigningTime: [{ _: formatSigningTime(signingTime) }],
              SigningCertificate: [
                {
                  Cert: [
                    {
                      CertDigest: [
                        {
                          DigestMethod: [
                            {
                              _: '',
                              Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256'
                            }
                          ],
                          DigestValue: [{ _: certDigestBase64 }]
                        }
                      ],
                      IssuerSerial: [
                        {
                          X509IssuerName: [{ _: certInfo.issuer.raw }],
                          X509SerialNumber: [{ _: certInfo.serialNumber }]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];
}

/**
 * Create the QualifyingProperties structure for hashing (to generate propsDigest)
 * Per LHDN SDK: Hash the full QualifyingProperties including Target wrapper
 */
function createQualifyingPropertiesForHashing(
  signingTime: Date,
  certDigestBase64: string,
  certInfo: CertificateInfo,
  _timestamp: string
): Record<string, unknown> {
  // Per LHDN SDK documentation: The propsDigest is calculated by hashing
  // the full QualifyingProperties structure (Target + SignedProperties),
  // NOT just the SignedProperties alone
  return {
    Target: 'signature',
    SignedProperties: [
      {
        Id: 'id-xades-signed-props',
        SignedSignatureProperties: [
          {
            SigningTime: [{ _: formatSigningTime(signingTime) }],
            SigningCertificate: [
              {
                Cert: [
                  {
                    CertDigest: [
                      {
                        DigestMethod: [
                          {
                            _: '',
                            Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256'
                          }
                        ],
                        DigestValue: [{ _: certDigestBase64 }]
                      }
                    ],
                    IssuerSerial: [
                      {
                        X509IssuerName: [{ _: certInfo.issuer.raw }],
                        X509SerialNumber: [{ _: certInfo.serialNumber }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

/**
 * Create the complete signature block in MyInvois UBL JSON format
 */
export function createSignatureBlock(
  digestValue: string,
  propsDigest: string,
  signatureValue: string,
  certPem: string,
  certDigestBase64: string,
  certInfo: CertificateInfo,
  signingTime: Date = new Date()
): SignatureBlock {
  const timestamp = signingTime.getTime().toString();

  const signedInfoUBL = createSignedInfoUBL(digestValue, propsDigest, timestamp);
  const keyInfoUBL = createKeyInfoUBL(certPem, certInfo);
  const qualifyingPropsUBL = createQualifyingPropertiesUBL(signingTime, certDigestBase64, certInfo, timestamp);

  return {
    signatureMethod: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    signatureValue,
    digestMethod: 'http://www.w3.org/2001/04/xmlenc#sha256',
    digestValue,
    certificateInfo: {
      issuer: certInfo.issuer.raw,
      serialNumber: certInfo.serialNumber,
      subject: certInfo.subject.raw
    },
    signingTime: formatSigningTime(signingTime),
    _raw: {
      Id: 'signature',
      Object: [
        {
          QualifyingProperties: qualifyingPropsUBL
        }
      ],
      KeyInfo: keyInfoUBL,
      SignatureValue: [{ _: signatureValue }],
      SignedInfo: signedInfoUBL
    }
  };
}

/**
 * Create UBL Extensions structure with signature
 * Uses MyInvois UBL JSON array-wrapped format: [{"_": value}] for simple values
 */
export function createUBLExtensions(signatureBlock: SignatureBlock): Record<string, unknown> {
  return {
    UBLExtension: [
      {
        ExtensionURI: [{ _: SIGNATURE_URIS.EXTENSION_URI }],
        ExtensionContent: [
          {
            UBLDocumentSignatures: [
              {
                SignatureInformation: [
                  {
                    ID: [{ _: SIGNATURE_URIS.SIGNATURE_ID }],
                    ReferencedSignatureID: [{ _: SIGNATURE_URIS.REFERENCED_SIGNATURE_ID }],
                    Signature: [signatureBlock._raw]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

/**
 * Create the Signature reference block for MyInvois
 * This block is placed at the Invoice level (not in UBLExtensions) and
 * acts as a reference pointer to the actual signature in UBLExtensions.
 *
 * Per MyInvois v1.1 requirements, both UBLExtensions (containing the full
 * digital signature) AND this Signature reference block must be present.
 */
function createSignatureReferenceBlock(): Record<string, unknown> {
  return {
    ID: [{ _: SIGNATURE_URIS.REFERENCED_SIGNATURE_ID }],
    SignatureMethod: [{ _: SIGNATURE_URIS.SIGNATURE_METHOD }]
  };
}

/**
 * Inject signature into document
 * Places the UBLExtensions at the beginning of the document wrapper
 * and adds a Signature reference block.
 *
 * For MyInvois JSON format, documents are wrapped in arrays:
 * { "_D": "...", "_A": "...", "_B": "...", "Invoice": [{...}] }
 *
 * The UBLExtensions should be placed INSIDE the array element as the first property,
 * and a Signature reference block is added to satisfy MyInvois v1.1 requirements:
 * { "_D": "...", "_A": "...", "_B": "...", "Invoice": [{ "UBLExtensions": [{...}], ...rest, "Signature": [{...}] }] }
 */
export function injectSignature(
  document: Record<string, unknown>,
  signatureBlock: SignatureBlock
): Record<string, unknown> {
  const extensions = createUBLExtensions(signatureBlock);
  const signatureRef = createSignatureReferenceBlock();

  // Helper to inject extensions and signature reference into a document element
  // Per MyInvois v1.1 spec, UBLExtensions and Signature must be at the END of the document
  const injectIntoElement = (
    element: unknown,
    _docType: string
  ): unknown => {
    // Handle array-wrapped documents (MyInvois format: Invoice: [{...}])
    if (Array.isArray(element) && element.length > 0) {
      const firstElement = element[0] as Record<string, unknown>;
      // Place UBLExtensions and Signature at end (after all document content)
      const signedElement = {
        ...firstElement,
        UBLExtensions: [extensions],  // MyInvois expects UBLExtensions as array
        Signature: [signatureRef]     // MyInvois v1.1 requires Signature reference block
      };
      return [signedElement, ...element.slice(1)];
    }

    // Handle object-wrapped documents (simple format: Invoice: {...})
    if (typeof element === 'object' && element !== null) {
      return {
        ...(element as Record<string, unknown>),
        UBLExtensions: [extensions],  // MyInvois expects UBLExtensions as array
        Signature: [signatureRef]     // MyInvois v1.1 requires Signature reference block
      };
    }

    return element;
  };

  // Preserve all top-level properties (including _D, _A, _B namespace prefixes)
  const result: Record<string, unknown> = {};

  // Copy namespace prefixes first
  if (document._D) result._D = document._D;
  if (document._A) result._A = document._A;
  if (document._B) result._B = document._B;

  // Process document type and copy other properties
  const documentTypes = ['Invoice', 'CreditNote', 'DebitNote'];
  let documentTypeFound = false;

  for (const [key, value] of Object.entries(document)) {
    if (key === '_D' || key === '_A' || key === '_B') {
      // Already handled above
      continue;
    }

    if (documentTypes.includes(key) && !documentTypeFound) {
      // Inject extensions into the document type
      result[key] = injectIntoElement(value, key);
      documentTypeFound = true;
    } else {
      result[key] = value;
    }
  }

  // If no known document type found, add extensions at top level
  if (!documentTypeFound) {
    return {
      ...result,
      UBLExtensions: [extensions]
    };
  }

  return result;
}

/**
 * Calculate SHA256 hash of certificate (DER format from PEM)
 */
function calculateCertificateDigest(certPem: string): string {
  // Extract certificate content without headers
  const certContent = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  // Decode base64 to get DER bytes, then hash
  const derBuffer = Buffer.from(certContent, 'base64');
  const hash = crypto.createHash('sha256').update(derBuffer).digest();
  return hash.toString('base64');
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
  const timestamp = signingTime.getTime().toString();

  // Step 1: Generate document hash (SHA256 of canonicalized document, base64)
  const digestValue = generateDocumentHash(document);

  // Step 2: Calculate certificate digest (SHA256 of DER certificate, base64)
  const certDigestBase64 = calculateCertificateDigest(certPem);

  // Step 3: Create QualifyingProperties and calculate its digest
  // Per LHDN SDK: Hash the full QualifyingProperties (Target + SignedProperties)
  const qualifyingProps = createQualifyingPropertiesForHashing(signingTime, certDigestBase64, certInfo, timestamp);
  const qualifyingPropsJson = JSON.stringify(qualifyingProps);
  const propsDigest = crypto.createHash('sha256').update(qualifyingPropsJson, 'utf8').digest('base64');

  // Step 4: Sign the canonicalized document
  // Per MyInvois SDK, the signature is created by signing the document bytes
  // using RSA-SHA256 (which internally hashes the document with SHA256)
  const docBytesToSign = canonicalizeDocument(document);
  const signatureValue = signData(docBytesToSign, privateKey);

  // Step 5: Create signature block
  const signatureBlock = createSignatureBlock(
    digestValue,
    propsDigest,
    signatureValue,
    certPem,
    certDigestBase64,
    certInfo,
    signingTime
  );

  // Step 6: Inject signature into document
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
