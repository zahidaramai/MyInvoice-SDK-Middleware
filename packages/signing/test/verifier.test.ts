import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  verify,
  VerificationService,
  extractSignature,
  recalculateHash
} from '../src/verifier.js';
import { sign, SigningService } from '../src/signer.js';
import { parsePrivateKey } from '../src/private-key-loader.js';
import { parseCertificate } from '../src/certificate-loader.js';
import type { CertificateInfo } from '../src/types.js';
import type { KeyObject } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Signature Verifier', () => {
  let privateKey: KeyObject;
  let certPem: string;
  let certInfo: CertificateInfo;
  let signingService: SigningService;

  beforeAll(() => {
    const keyPem = fs.readFileSync(path.join(fixturesDir, 'valid-key.pem'), 'utf-8');
    certPem = fs.readFileSync(path.join(fixturesDir, 'valid-cert.pem'), 'utf-8');
    privateKey = parsePrivateKey(keyPem);
    certInfo = parseCertificate(certPem);
    signingService = new SigningService(privateKey, certPem, certInfo);
  });

  describe('extractSignature', () => {
    it('extracts signature from signed Invoice document', () => {
      const doc = { Invoice: { ID: 'INV-001' } };
      const { signedDocument } = signingService.sign(doc);

      const extracted = extractSignature(signedDocument);

      expect(extracted.signatureBlock).not.toBeNull();
      expect(extracted.digestValue).toBeTruthy();
      expect(extracted.signatureValue).toBeTruthy();
      expect(extracted.certificatePem).toBeTruthy();
      expect(extracted.signedInfo).toBeTruthy();
    });

    it('extracts signature from signed CreditNote document', () => {
      const doc = { CreditNote: { ID: 'CN-001' } };
      const { signedDocument } = signingService.sign(doc);

      const extracted = extractSignature(signedDocument);

      expect(extracted.signatureBlock).not.toBeNull();
    });

    it('extracts signature from signed DebitNote document', () => {
      const doc = { DebitNote: { ID: 'DN-001' } };
      const { signedDocument } = signingService.sign(doc);

      const extracted = extractSignature(signedDocument);

      expect(extracted.signatureBlock).not.toBeNull();
    });

    it('returns null for unsigned document', () => {
      const doc = { Invoice: { ID: 'INV-001' } };

      const extracted = extractSignature(doc);

      expect(extracted.signatureBlock).toBeNull();
      expect(extracted.digestValue).toBeNull();
      expect(extracted.signatureValue).toBeNull();
    });

    it('extracts certificate PEM correctly', () => {
      const doc = { Invoice: { ID: 'INV-001' } };
      const { signedDocument } = signingService.sign(doc);

      const extracted = extractSignature(signedDocument);

      expect(extracted.certificatePem).toContain('-----BEGIN CERTIFICATE-----');
      expect(extracted.certificatePem).toContain('-----END CERTIFICATE-----');
    });
  });

  describe('recalculateHash', () => {
    it('calculates hash excluding signature', () => {
      const doc = { Invoice: { ID: 'INV-001', Amount: 100 } };
      const { signedDocument, documentHash } = signingService.sign(doc);

      const recalculated = recalculateHash(signedDocument);

      expect(recalculated).toBe(documentHash);
    });

    it('produces same hash as original document', () => {
      const originalDoc = { Invoice: { ID: 'INV-001' } };
      const { signedDocument } = signingService.sign(originalDoc);

      const originalHash = recalculateHash(originalDoc);
      const signedHash = recalculateHash(signedDocument);

      expect(signedHash).toBe(originalHash);
    });
  });

  describe('verify', () => {
    it('verifies valid signed document', () => {
      const doc = { Invoice: { ID: 'INV-001', Amount: 100 } };
      const { signedDocument } = signingService.sign(doc);

      const result = verify(signedDocument);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns correct document hash info', () => {
      const doc = { Invoice: { ID: 'INV-001' } };
      const { signedDocument, documentHash } = signingService.sign(doc);

      const result = verify(signedDocument);

      expect(result.document.hashValid).toBe(true);
      expect(result.document.computedHash).toBe(documentHash);
      expect(result.document.claimedHash).toBe(documentHash);
    });

    it('returns correct signature info', () => {
      const doc = { Invoice: { ID: 'INV-001' } };
      const { signedDocument } = signingService.sign(doc);

      const result = verify(signedDocument);

      expect(result.signature.valid).toBe(true);
      expect(result.signature.algorithm).toBeTruthy();
    });

    it('returns correct certificate info', () => {
      const doc = { Invoice: { ID: 'INV-001' } };
      const { signedDocument } = signingService.sign(doc);

      const result = verify(signedDocument);

      expect(result.certificate.valid).toBe(certInfo.isValid);
      expect(result.certificate.issuer).toBe(certInfo.issuer.raw);
      expect(result.certificate.subject).toBe(certInfo.subject.raw);
      expect(result.certificate.expiresAt).toEqual(certInfo.validTo);
    });

    it('fails for unsigned document', () => {
      const doc = { Invoice: { ID: 'INV-001' } };

      const result = verify(doc);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing signature block');
    });

    it('detects tampered document (hash mismatch)', () => {
      const doc = { Invoice: { ID: 'INV-001', Amount: 100 } };
      const { signedDocument } = signingService.sign(doc);

      // Tamper with the document
      const invoice = signedDocument.Invoice as Record<string, unknown>;
      invoice.Amount = 999;

      const result = verify(signedDocument);

      expect(result.valid).toBe(false);
      expect(result.document.hashValid).toBe(false);
      expect(result.errors).toContain('Document hash mismatch - document may have been tampered');
    });

    it('handles complex nested documents', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          AccountingSupplierParty: {
            Party: {
              PartyName: { Name: 'Test Company' }
            }
          },
          InvoiceLine: [
            { ID: '1', Amount: 100 },
            { ID: '2', Amount: 200 }
          ]
        }
      };

      const { signedDocument } = signingService.sign(doc);
      const result = verify(signedDocument);

      expect(result.valid).toBe(true);
    });
  });

  describe('VerificationService', () => {
    it('creates instance', () => {
      const service = new VerificationService();
      expect(service).toBeDefined();
    });

    it('verifies documents', () => {
      const service = new VerificationService();
      const doc = { Invoice: { ID: 'INV-001' } };
      const { signedDocument } = signingService.sign(doc);

      const result = service.verify(signedDocument);

      expect(result.valid).toBe(true);
    });

    it('checks if document has signature', () => {
      const service = new VerificationService();

      const unsignedDoc = { Invoice: { ID: 'INV-001' } };
      expect(service.hasSignature(unsignedDoc)).toBe(false);

      const { signedDocument } = signingService.sign(unsignedDoc);
      expect(service.hasSignature(signedDocument)).toBe(true);
    });

    it('gets claimed hash from signed document', () => {
      const service = new VerificationService();
      const doc = { Invoice: { ID: 'INV-001' } };
      const { signedDocument, documentHash } = signingService.sign(doc);

      const claimedHash = service.getClaimedHash(signedDocument);

      expect(claimedHash).toBe(documentHash);
    });

    it('returns null for unsigned document hash', () => {
      const service = new VerificationService();
      const doc = { Invoice: { ID: 'INV-001' } };

      const claimedHash = service.getClaimedHash(doc);

      expect(claimedHash).toBeNull();
    });

    it('recalculates hash', () => {
      const service = new VerificationService();
      const doc = { Invoice: { ID: 'INV-001' } };
      const { signedDocument, documentHash } = signingService.sign(doc);

      const recalculated = service.recalculateHash(signedDocument);

      expect(recalculated).toBe(documentHash);
    });
  });

  describe('round-trip verification', () => {
    it('sign and verify works correctly', () => {
      const doc = { Invoice: { ID: 'INV-001', Amount: 500 } };

      const { signedDocument } = signingService.sign(doc);
      const result = verify(signedDocument);

      expect(result.valid).toBe(true);
      expect(result.document.hashValid).toBe(true);
      expect(result.signature.valid).toBe(true);
      expect(result.certificate.valid).toBe(true);
    });

    it('multiple sign and verify cycles work', () => {
      const docs = [
        { Invoice: { ID: 'INV-001' } },
        { CreditNote: { ID: 'CN-001' } },
        { DebitNote: { ID: 'DN-001' } }
      ];

      for (const doc of docs) {
        const { signedDocument } = signingService.sign(doc);
        const result = verify(signedDocument);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('error cases', () => {
    it('handles malformed UBLExtensions gracefully', () => {
      const doc = {
        Invoice: {
          UBLExtensions: 'not an object',
          ID: 'INV-001'
        }
      };

      const result = verify(doc);

      expect(result.valid).toBe(false);
    });

    it('handles empty UBLExtension array', () => {
      const doc = {
        Invoice: {
          UBLExtensions: { UBLExtension: [] },
          ID: 'INV-001'
        }
      };

      const result = verify(doc);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing signature block');
    });

    it('handles missing ExtensionContent', () => {
      const doc = {
        Invoice: {
          UBLExtensions: {
            UBLExtension: [{ ExtensionURI: 'test' }]
          },
          ID: 'INV-001'
        }
      };

      const result = verify(doc);

      expect(result.valid).toBe(false);
    });
  });
});
