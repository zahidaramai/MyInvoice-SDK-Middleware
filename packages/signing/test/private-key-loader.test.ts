import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  loadPrivateKey,
  loadPrivateKeyFromFile,
  loadPrivateKeyFromBase64,
  loadPrivateKeyFromEnv,
  loadAndVerifyPrivateKey,
  parsePrivateKey,
  verifyKeyMatchesCertificate,
  getPrivateKeyInfo
} from '../src/private-key-loader.js';
import {
  PrivateKeyLoadError,
  KeyCertificateMismatchError
} from '../src/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Private Key Loader', () => {
  const validKeyPath = path.join(fixturesDir, 'valid-key.pem');
  const validCertPath = path.join(fixturesDir, 'valid-cert.pem');
  const encryptedKeyPath = path.join(fixturesDir, 'encrypted-key.pem');
  const mismatchedKeyPath = path.join(fixturesDir, 'mismatched-key.pem');
  const ecKeyPath = path.join(fixturesDir, 'ec-key.pem');

  describe('loadPrivateKeyFromFile', () => {
    it('loads private key from valid file path', () => {
      const pem = loadPrivateKeyFromFile(validKeyPath);
      expect(pem).toContain('-----BEGIN PRIVATE KEY-----');
    });

    it('throws PrivateKeyLoadError for non-existent file', () => {
      expect(() => loadPrivateKeyFromFile('/non/existent/path.pem')).toThrow(
        PrivateKeyLoadError
      );
    });
  });

  describe('loadPrivateKeyFromBase64', () => {
    it('loads private key from base64 encoded data', () => {
      const originalPem = fs.readFileSync(validKeyPath, 'utf-8');
      const base64 = Buffer.from(originalPem).toString('base64');

      const decoded = loadPrivateKeyFromBase64(base64);
      expect(decoded).toBe(originalPem);
    });
  });

  describe('loadPrivateKeyFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('loads private key from environment variable', () => {
      const keyContent = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
      process.env.TEST_KEY = keyContent;

      const result = loadPrivateKeyFromEnv('TEST_KEY');
      expect(result).toBe(keyContent);
    });

    it('throws PrivateKeyLoadError for missing env var', () => {
      delete process.env.MISSING_KEY;
      expect(() => loadPrivateKeyFromEnv('MISSING_KEY')).toThrow(
        PrivateKeyLoadError
      );
    });
  });

  describe('parsePrivateKey', () => {
    it('parses unencrypted RSA private key', () => {
      const pem = fs.readFileSync(validKeyPath, 'utf-8');
      const key = parsePrivateKey(pem);

      expect(key).toBeDefined();
      expect(key.asymmetricKeyType).toBe('rsa');
    });

    it('parses encrypted private key with correct passphrase', () => {
      const pem = fs.readFileSync(encryptedKeyPath, 'utf-8');
      const key = parsePrivateKey(pem, 'testpassword');

      expect(key).toBeDefined();
      expect(key.asymmetricKeyType).toBe('rsa');
    });

    it('throws PrivateKeyLoadError for encrypted key without passphrase', () => {
      const pem = fs.readFileSync(encryptedKeyPath, 'utf-8');

      expect(() => parsePrivateKey(pem)).toThrow(PrivateKeyLoadError);
    });

    it('throws PrivateKeyLoadError for encrypted key with wrong passphrase', () => {
      const pem = fs.readFileSync(encryptedKeyPath, 'utf-8');

      expect(() => parsePrivateKey(pem, 'wrongpassword')).toThrow(
        PrivateKeyLoadError
      );
    });

    it('parses EC private key', () => {
      const pem = fs.readFileSync(ecKeyPath, 'utf-8');
      const key = parsePrivateKey(pem);

      expect(key).toBeDefined();
      expect(key.asymmetricKeyType).toBe('ec');
    });

    it('throws PrivateKeyLoadError for invalid PEM', () => {
      expect(() => parsePrivateKey('not a private key')).toThrow(
        PrivateKeyLoadError
      );
    });
  });

  describe('loadPrivateKey', () => {
    it('loads private key from file source', () => {
      const key = loadPrivateKey({ path: validKeyPath });

      expect(key).toBeDefined();
      expect(key.asymmetricKeyType).toBe('rsa');
    });

    it('loads encrypted key with passphrase', () => {
      const key = loadPrivateKey({
        path: encryptedKeyPath,
        passphrase: 'testpassword'
      });

      expect(key).toBeDefined();
      expect(key.asymmetricKeyType).toBe('rsa');
    });

    it('loads key from base64 source', () => {
      const originalPem = fs.readFileSync(validKeyPath, 'utf-8');
      const base64 = Buffer.from(originalPem).toString('base64');

      const key = loadPrivateKey({ base64 });
      expect(key.asymmetricKeyType).toBe('rsa');
    });

    it('throws when no source specified', () => {
      expect(() => loadPrivateKey({})).toThrow(PrivateKeyLoadError);
    });
  });

  describe('verifyKeyMatchesCertificate', () => {
    it('returns true for matching key and certificate', () => {
      const keyPem = fs.readFileSync(validKeyPath, 'utf-8');
      const certPem = fs.readFileSync(validCertPath, 'utf-8');
      const key = parsePrivateKey(keyPem);

      expect(verifyKeyMatchesCertificate(key, certPem)).toBe(true);
    });

    it('returns false for mismatched key and certificate', () => {
      const keyPem = fs.readFileSync(mismatchedKeyPath, 'utf-8');
      const certPem = fs.readFileSync(validCertPath, 'utf-8');
      const key = parsePrivateKey(keyPem);

      expect(verifyKeyMatchesCertificate(key, certPem)).toBe(false);
    });
  });

  describe('loadAndVerifyPrivateKey', () => {
    it('loads and verifies matching key', () => {
      const certPem = fs.readFileSync(validCertPath, 'utf-8');

      const key = loadAndVerifyPrivateKey(
        { path: validKeyPath },
        certPem,
        'Test Certificate'
      );

      expect(key).toBeDefined();
      expect(key.asymmetricKeyType).toBe('rsa');
    });

    it('throws KeyCertificateMismatchError for mismatched key', () => {
      const certPem = fs.readFileSync(validCertPath, 'utf-8');

      expect(() =>
        loadAndVerifyPrivateKey(
          { path: mismatchedKeyPath },
          certPem,
          'Test Certificate'
        )
      ).toThrow(KeyCertificateMismatchError);
    });
  });

  describe('getPrivateKeyInfo', () => {
    it('returns correct info for RSA key', () => {
      const pem = fs.readFileSync(validKeyPath, 'utf-8');
      const key = parsePrivateKey(pem);
      const info = getPrivateKeyInfo(key);

      expect(info.type).toBe('rsa');
      expect(info.keySize).toBe(2048);
    });

    it('returns correct info for EC key', () => {
      const pem = fs.readFileSync(ecKeyPath, 'utf-8');
      const key = parsePrivateKey(pem);
      const info = getPrivateKeyInfo(key);

      expect(info.type).toBe('ec');
      expect(info.keySize).toBe(256); // P-256 curve
    });
  });
});
