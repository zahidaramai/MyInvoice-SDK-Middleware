import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  sign,
  SigningService,
  createSignatureBlock,
  createUBLExtensions,
  injectSignature,
  SIGNATURE_URIS
} from '../src/signer.js';
import { parsePrivateKey } from '../src/private-key-loader.js';
import { parseCertificate } from '../src/certificate-loader.js';
import { generateDocumentHash } from '../src/hash.js';
import type { CertificateInfo } from '../src/types.js';
import type { KeyObject } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Document Signer', () => {
  let privateKey: KeyObject;
  let certPem: string;
  let certInfo: CertificateInfo;

  beforeAll(() => {
    const keyPem = fs.readFileSync(path.join(fixturesDir, 'valid-key.pem'), 'utf-8');
    certPem = fs.readFileSync(path.join(fixturesDir, 'valid-cert.pem'), 'utf-8');
    privateKey = parsePrivateKey(keyPem);
    certInfo = parseCertificate(certPem);
  });

  describe('SIGNATURE_URIS', () => {
    it('has correct extension URI', () => {
      expect(SIGNATURE_URIS.EXTENSION_URI).toBe('urn:oasis:names:specification:ubl:dsig:enveloped:xades');
    });

    it('has correct digest method', () => {
      expect(SIGNATURE_URIS.DIGEST_METHOD).toBe('http://www.w3.org/2001/04/xmlenc#sha256');
    });
  });

  describe('createSignatureBlock', () => {
    it('creates signature block with required properties', () => {
      const digestValue = 'dGVzdGRpZ2VzdA==';
      const signatureValue = 'dGVzdHNpZ25hdHVyZQ==';
      const signingTime = new Date('2026-01-13T12:00:00Z');

      const block = createSignatureBlock(
        digestValue,
        signatureValue,
        certPem,
        certInfo,
        signingTime
      );

      expect(block.signatureMethod).toBe(SIGNATURE_URIS.SIGNATURE_METHOD);
      expect(block.signatureValue).toBe(signatureValue);
      expect(block.digestMethod).toBe(SIGNATURE_URIS.DIGEST_METHOD);
      expect(block.digestValue).toBe(digestValue);
      expect(block.signingTime).toBe('2026-01-13T12:00:00.000Z');
    });

    it('includes certificate info', () => {
      const block = createSignatureBlock(
        'digest',
        'signature',
        certPem,
        certInfo
      );

      expect(block.certificateInfo).toBeDefined();
      expect(block.certificateInfo.issuer).toBe(certInfo.issuer.raw);
      expect(block.certificateInfo.subject).toBe(certInfo.subject.raw);
      expect(block.certificateInfo.serialNumber).toBe(certInfo.serialNumber);
    });

    it('includes raw UBL structure', () => {
      const block = createSignatureBlock(
        'digest',
        'signature',
        certPem,
        certInfo
      );

      expect(block._raw).toBeDefined();
      expect(block._raw.Id).toBe('signature');
      expect(block._raw.SignedInfo).toBeDefined();
      expect(block._raw.SignatureValue).toBe('signature');
      expect(block._raw.KeyInfo).toBeDefined();
      expect(block._raw.Object).toBeDefined();
    });
  });

  describe('createUBLExtensions', () => {
    it('creates correct UBL extension structure', () => {
      const block = createSignatureBlock(
        'digest',
        'signature',
        certPem,
        certInfo
      );

      const extensions = createUBLExtensions(block);

      expect(extensions.UBLExtension).toBeInstanceOf(Array);
      expect(extensions.UBLExtension).toHaveLength(1);
    });

    it('includes correct extension URI', () => {
      const block = createSignatureBlock(
        'digest',
        'signature',
        certPem,
        certInfo
      );

      const extensions = createUBLExtensions(block);
      const ext = (extensions.UBLExtension as Array<Record<string, unknown>>)[0];

      expect(ext.ExtensionURI).toBe(SIGNATURE_URIS.EXTENSION_URI);
      expect(ext.ExtensionContent).toBeDefined();
    });

    it('includes signature information', () => {
      const block = createSignatureBlock(
        'digest',
        'signature',
        certPem,
        certInfo
      );

      const extensions = createUBLExtensions(block);
      const ext = (extensions.UBLExtension as Array<Record<string, unknown>>)[0];
      const content = ext.ExtensionContent as Record<string, unknown>;
      const sigs = content.UBLDocumentSignatures as Record<string, unknown>;

      expect(sigs.SignatureInformation).toBeDefined();
    });
  });

  describe('injectSignature', () => {
    it('injects signature into Invoice document', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const block = createSignatureBlock(
        'digest',
        'signature',
        certPem,
        certInfo
      );

      const signedDoc = injectSignature(doc, block);

      expect(signedDoc.Invoice).toBeDefined();
      const invoice = signedDoc.Invoice as Record<string, unknown>;
      expect(invoice.UBLExtensions).toBeDefined();
      expect(invoice.ID).toBe('INV-001');
    });

    it('injects signature into CreditNote document', () => {
      const doc = {
        CreditNote: {
          ID: 'CN-001'
        }
      };

      const block = createSignatureBlock(
        'digest',
        'signature',
        certPem,
        certInfo
      );

      const signedDoc = injectSignature(doc, block);

      const creditNote = signedDoc.CreditNote as Record<string, unknown>;
      expect(creditNote.UBLExtensions).toBeDefined();
    });

    it('injects signature into DebitNote document', () => {
      const doc = {
        DebitNote: {
          ID: 'DN-001'
        }
      };

      const block = createSignatureBlock(
        'digest',
        'signature',
        certPem,
        certInfo
      );

      const signedDoc = injectSignature(doc, block);

      const debitNote = signedDoc.DebitNote as Record<string, unknown>;
      expect(debitNote.UBLExtensions).toBeDefined();
    });

    it('places UBLExtensions at beginning of document', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const block = createSignatureBlock(
        'digest',
        'signature',
        certPem,
        certInfo
      );

      const signedDoc = injectSignature(doc, block);
      const invoice = signedDoc.Invoice as Record<string, unknown>;
      const keys = Object.keys(invoice);

      expect(keys[0]).toBe('UBLExtensions');
    });
  });

  describe('sign', () => {
    it('signs document successfully', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const result = sign(doc, privateKey, certPem, certInfo);

      expect(result.signedDocument).toBeDefined();
      expect(result.signatureBlock).toBeDefined();
      expect(result.documentHash).toBeDefined();
      expect(result.signedAt).toBeInstanceOf(Date);
    });

    it('generates valid document hash', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const result = sign(doc, privateKey, certPem, certInfo);
      const expectedHash = generateDocumentHash(doc);

      expect(result.documentHash).toBe(expectedHash);
    });

    it('generates unique signature value', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const result = sign(doc, privateKey, certPem, certInfo);

      expect(result.signatureBlock.signatureValue).toBeTruthy();
      expect(result.signatureBlock.signatureValue.length).toBeGreaterThan(10);
    });

    it('uses provided signing time', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001'
        }
      };

      const signingTime = new Date('2026-01-13T15:30:00Z');
      const result = sign(doc, privateKey, certPem, certInfo, signingTime);

      expect(result.signedAt).toEqual(signingTime);
      expect(result.signatureBlock.signingTime).toBe('2026-01-13T15:30:00.000Z');
    });

    it('injects signature into document', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001'
        }
      };

      const result = sign(doc, privateKey, certPem, certInfo);
      const invoice = result.signedDocument.Invoice as Record<string, unknown>;

      expect(invoice.UBLExtensions).toBeDefined();
    });

    it('handles complex nested documents', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          AccountingSupplierParty: {
            Party: {
              PartyName: { Name: 'Test Company' },
              PostalAddress: {
                StreetName: '123 Test Street',
                CityName: 'Kuala Lumpur',
                CountrySubentity: 'Selangor',
                Country: { IdentificationCode: 'MY' }
              }
            }
          },
          InvoiceLine: [
            { ID: '1', LineExtensionAmount: 100 },
            { ID: '2', LineExtensionAmount: 200 }
          ]
        }
      };

      const result = sign(doc, privateKey, certPem, certInfo);

      expect(result.signedDocument).toBeDefined();
      expect(result.documentHash).toBeTruthy();
    });
  });

  describe('SigningService', () => {
    it('creates instance with certificate info', () => {
      const service = new SigningService(privateKey, certPem, certInfo);

      expect(service.getCertificateInfo()).toBe(certInfo);
    });

    it('signs documents correctly', () => {
      const service = new SigningService(privateKey, certPem, certInfo);
      const doc = {
        Invoice: {
          ID: 'INV-001'
        }
      };

      const result = service.sign(doc);

      expect(result.signedDocument).toBeDefined();
      expect(result.signatureBlock).toBeDefined();
    });

    it('reports certificate validity', () => {
      const service = new SigningService(privateKey, certPem, certInfo);

      expect(service.isCertificateValid()).toBe(certInfo.isValid);
    });

    it('reports days until expiry', () => {
      const service = new SigningService(privateKey, certPem, certInfo);

      expect(service.getDaysUntilExpiry()).toBe(certInfo.daysUntilExpiry);
    });

    it('uses custom signing time', () => {
      const service = new SigningService(privateKey, certPem, certInfo);
      const doc = {
        Invoice: {
          ID: 'INV-001'
        }
      };

      const signingTime = new Date('2026-06-15T10:00:00Z');
      const result = service.sign(doc, signingTime);

      expect(result.signedAt).toEqual(signingTime);
    });
  });

  describe('signature consistency', () => {
    it('produces same hash for same document', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const result1 = sign(doc, privateKey, certPem, certInfo);
      const result2 = sign(doc, privateKey, certPem, certInfo);

      expect(result1.documentHash).toBe(result2.documentHash);
    });

    it('produces different hash for different documents', () => {
      const doc1 = { Invoice: { ID: 'INV-001' } };
      const doc2 = { Invoice: { ID: 'INV-002' } };

      const result1 = sign(doc1, privateKey, certPem, certInfo);
      const result2 = sign(doc2, privateKey, certPem, certInfo);

      expect(result1.documentHash).not.toBe(result2.documentHash);
    });
  });
});
