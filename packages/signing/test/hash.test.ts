import { describe, it, expect } from 'vitest';
import {
  canonicalizeDocument,
  generateDocumentHash,
  generateDocumentHashHex,
  hashString,
  verifyDocumentHash,
  _sortKeysRecursively,
  _removeSignatureExtension
} from '../src/hash.js';

describe('Hash Generation', () => {
  describe('sortKeysRecursively', () => {
    it('sorts object keys alphabetically', () => {
      const input = { z: 1, a: 2, m: 3 };
      const result = _sortKeysRecursively(input) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['a', 'm', 'z']);
    });

    it('sorts nested object keys', () => {
      const input = {
        outer: { z: 1, a: 2 },
        another: { x: 3, b: 4 }
      };
      const result = _sortKeysRecursively(input) as Record<string, Record<string, unknown>>;
      expect(Object.keys(result)).toEqual(['another', 'outer']);
      expect(Object.keys(result.another)).toEqual(['b', 'x']);
      expect(Object.keys(result.outer)).toEqual(['a', 'z']);
    });

    it('sorts arrays with objects', () => {
      const input = [{ z: 1, a: 2 }, { x: 3, b: 4 }];
      const result = _sortKeysRecursively(input) as Array<Record<string, unknown>>;
      expect(Object.keys(result[0])).toEqual(['a', 'z']);
      expect(Object.keys(result[1])).toEqual(['b', 'x']);
    });

    it('handles null and undefined', () => {
      expect(_sortKeysRecursively(null)).toBeNull();
      expect(_sortKeysRecursively(undefined)).toBeUndefined();
    });

    it('handles primitive values', () => {
      expect(_sortKeysRecursively('string')).toBe('string');
      expect(_sortKeysRecursively(123)).toBe(123);
      expect(_sortKeysRecursively(true)).toBe(true);
    });
  });

  describe('removeSignatureExtension', () => {
    it('removes UBLExtensions from Invoice', () => {
      const doc = {
        Invoice: {
          UBLExtensions: { some: 'data' },
          ID: 'INV-001'
        }
      };
      const result = _removeSignatureExtension(doc);
      expect(result).toEqual({
        Invoice: { ID: 'INV-001' }
      });
    });

    it('removes UBLExtensions from CreditNote', () => {
      const doc = {
        CreditNote: {
          UBLExtensions: { some: 'data' },
          ID: 'CN-001'
        }
      };
      const result = _removeSignatureExtension(doc);
      expect(result).toEqual({
        CreditNote: { ID: 'CN-001' }
      });
    });

    it('removes UBLExtensions from DebitNote', () => {
      const doc = {
        DebitNote: {
          UBLExtensions: { some: 'data' },
          ID: 'DN-001'
        }
      };
      const result = _removeSignatureExtension(doc);
      expect(result).toEqual({
        DebitNote: { ID: 'DN-001' }
      });
    });

    it('removes UBLExtensions from unwrapped document', () => {
      const doc = {
        UBLExtensions: { some: 'data' },
        ID: 'INV-001'
      };
      const result = _removeSignatureExtension(doc);
      expect(result).toEqual({ ID: 'INV-001' });
    });

    it('preserves document without UBLExtensions', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };
      const result = _removeSignatureExtension(doc);
      expect(result).toEqual(doc);
    });
  });

  describe('canonicalizeDocument', () => {
    it('produces consistent output for same document', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const result1 = canonicalizeDocument(doc);
      const result2 = canonicalizeDocument(doc);
      expect(result1).toBe(result2);
    });

    it('produces different output for different key order (per MyInvois SDK spec)', () => {
      // Per MyInvois SDK spec, no key sorting is performed
      // Key order matters - JSON.stringify preserves insertion order
      const doc1 = { Invoice: { ID: 'INV-001', Amount: 100 } };
      const doc2 = { Invoice: { Amount: 100, ID: 'INV-001' } };

      const result1 = canonicalizeDocument(doc1);
      const result2 = canonicalizeDocument(doc2);
      // Key order is preserved, so different order = different output
      expect(result1).not.toBe(result2);
    });

    it('removes UBLExtensions before canonicalizing', () => {
      const docWithSig = {
        Invoice: {
          UBLExtensions: { signature: 'test' },
          ID: 'INV-001'
        }
      };
      const docWithoutSig = {
        Invoice: {
          ID: 'INV-001'
        }
      };

      const result1 = canonicalizeDocument(docWithSig);
      const result2 = canonicalizeDocument(docWithoutSig);
      expect(result1).toBe(result2);
    });

    it('handles nested objects correctly', () => {
      const doc = {
        Invoice: {
          AccountingSupplierParty: {
            Party: {
              PartyName: { Name: 'TestCompany' }
            }
          },
          ID: 'INV-001'
        }
      };

      const result = canonicalizeDocument(doc);
      expect(result).toContain('AccountingSupplierParty');
      expect(result).toContain('PartyName');
      // Check no formatting whitespace (newlines, indentation)
      expect(result).not.toMatch(/\n/);
      expect(result).not.toMatch(/\t/);
    });

    it('handles special characters', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Description: 'Test with special chars: \u00e9\u00e8\u00ea'
        }
      };

      const result = canonicalizeDocument(doc);
      expect(result).toContain('\u00e9');
    });

    it('handles arrays correctly', () => {
      const doc = {
        Invoice: {
          InvoiceLine: [
            { ID: '1', Amount: 100 },
            { ID: '2', Amount: 200 }
          ]
        }
      };

      const result = canonicalizeDocument(doc);
      expect(result).toContain('InvoiceLine');
    });
  });

  describe('generateDocumentHash', () => {
    it('generates base64-encoded SHA-256 hash', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const hash = generateDocumentHash(doc);

      // Base64 encoded SHA-256 is always 44 characters
      expect(hash).toHaveLength(44);
      expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('produces consistent hash for same document', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const hash1 = generateDocumentHash(doc);
      const hash2 = generateDocumentHash(doc);
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different key order (per MyInvois SDK spec)', () => {
      // Per MyInvois SDK spec, no key sorting is performed
      // Key order matters - JSON.stringify preserves insertion order
      const doc1 = { Invoice: { ID: 'INV-001', Amount: 100 } };
      const doc2 = { Invoice: { Amount: 100, ID: 'INV-001' } };

      const hash1 = generateDocumentHash(doc1);
      const hash2 = generateDocumentHash(doc2);
      // Different key order = different hash
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hash for different documents', () => {
      const doc1 = { Invoice: { ID: 'INV-001', Amount: 100 } };
      const doc2 = { Invoice: { ID: 'INV-002', Amount: 100 } };

      const hash1 = generateDocumentHash(doc1);
      const hash2 = generateDocumentHash(doc2);
      expect(hash1).not.toBe(hash2);
    });

    it('ignores UBLExtensions when hashing', () => {
      const docWithSig = {
        Invoice: {
          UBLExtensions: { signature: 'test' },
          ID: 'INV-001'
        }
      };
      const docWithoutSig = {
        Invoice: {
          ID: 'INV-001'
        }
      };

      const hash1 = generateDocumentHash(docWithSig);
      const hash2 = generateDocumentHash(docWithoutSig);
      expect(hash1).toBe(hash2);
    });
  });

  describe('generateDocumentHashHex', () => {
    it('generates hex-encoded SHA-256 hash', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const hash = generateDocumentHashHex(doc);

      // Hex encoded SHA-256 is always 64 characters
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('hashString', () => {
    it('hashes string correctly', () => {
      const hash = hashString('Hello, World!');

      expect(hash).toHaveLength(44);
      expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('produces consistent hash', () => {
      const hash1 = hashString('test');
      const hash2 = hashString('test');
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different input', () => {
      const hash1 = hashString('test1');
      const hash2 = hashString('test2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyDocumentHash', () => {
    it('returns true for matching hash', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const hash = generateDocumentHash(doc);
      expect(verifyDocumentHash(doc, hash)).toBe(true);
    });

    it('returns false for non-matching hash', () => {
      const doc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      expect(verifyDocumentHash(doc, 'invalid-hash')).toBe(false);
    });

    it('returns false for tampered document', () => {
      const originalDoc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 100
        }
      };

      const hash = generateDocumentHash(originalDoc);

      const tamperedDoc = {
        Invoice: {
          ID: 'INV-001',
          Amount: 999
        }
      };

      expect(verifyDocumentHash(tamperedDoc, hash)).toBe(false);
    });
  });
});
