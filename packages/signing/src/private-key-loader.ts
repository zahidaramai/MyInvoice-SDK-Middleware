import * as crypto from 'crypto';
import * as fs from 'fs';
import type { PrivateKeySource } from './config.js';
import { PrivateKeyLoadError, KeyCertificateMismatchError } from './errors.js';

/**
 * Load private key content from a file path
 */
export function loadPrivateKeyFromFile(path: string): string {
  try {
    return fs.readFileSync(path, 'utf-8');
  } catch (error) {
    throw new PrivateKeyLoadError(
      `Failed to load private key from file: ${path}`,
      { source: 'file', path, cause: error as Error }
    );
  }
}

/**
 * Load private key content from a base64-encoded string
 */
export function loadPrivateKeyFromBase64(base64Data: string): string {
  try {
    return Buffer.from(base64Data, 'base64').toString('utf-8');
  } catch (error) {
    throw new PrivateKeyLoadError(
      'Failed to decode base64 private key data',
      { source: 'base64', cause: error as Error }
    );
  }
}

/**
 * Load private key content from an environment variable
 */
export function loadPrivateKeyFromEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new PrivateKeyLoadError(
      `Environment variable ${envVar} is not set or empty`,
      { source: 'env' }
    );
  }
  return value;
}

/**
 * Load private key PEM content from the specified source
 */
export function loadPrivateKeyPem(source: PrivateKeySource): string {
  if (source.path) {
    return loadPrivateKeyFromFile(source.path);
  }
  if (source.base64) {
    return loadPrivateKeyFromBase64(source.base64);
  }
  if (source.envVar) {
    return loadPrivateKeyFromEnv(source.envVar);
  }
  throw new PrivateKeyLoadError('No private key source specified');
}

/**
 * Parse a PEM-encoded private key
 * Handles both encrypted and unencrypted keys
 */
export function parsePrivateKey(
  pemContent: string,
  passphrase?: string
): crypto.KeyObject {
  try {
    // Determine if the key is encrypted
    const isEncrypted = pemContent.includes('ENCRYPTED');

    if (isEncrypted && !passphrase) {
      throw new PrivateKeyLoadError(
        'Private key is encrypted but no passphrase was provided',
        { encrypted: true }
      );
    }

    const keyOptions: crypto.PrivateKeyInput = {
      key: pemContent,
      format: 'pem'
    };

    if (passphrase) {
      keyOptions.passphrase = passphrase;
    }

    return crypto.createPrivateKey(keyOptions);
  } catch (error) {
    if (error instanceof PrivateKeyLoadError) {
      throw error;
    }

    // Check for common error types
    const errorMessage = (error as Error).message || '';

    if (errorMessage.includes('bad decrypt') || errorMessage.includes('wrong password')) {
      throw new PrivateKeyLoadError(
        'Failed to decrypt private key: Invalid passphrase',
        { encrypted: true, cause: error as Error }
      );
    }

    if (errorMessage.includes('unsupported') || errorMessage.includes('invalid')) {
      throw new PrivateKeyLoadError(
        'Failed to parse private key: Unsupported or invalid format',
        { cause: error as Error }
      );
    }

    throw new PrivateKeyLoadError(
      'Failed to parse private key: ' + errorMessage,
      { cause: error as Error }
    );
  }
}

/**
 * Get the public key from a private key
 */
export function getPublicKeyFromPrivate(privateKey: crypto.KeyObject): crypto.KeyObject {
  // Create public key from private key
  const publicKeyPem = crypto.createPublicKey(privateKey).export({
    type: 'spki',
    format: 'pem'
  });
  return crypto.createPublicKey(publicKeyPem as string);
}

/**
 * Verify that a private key matches a certificate's public key
 */
export function verifyKeyMatchesCertificate(
  privateKey: crypto.KeyObject,
  certificatePem: string
): boolean {
  try {
    const cert = new crypto.X509Certificate(certificatePem);

    // Get public key from certificate
    const certPublicKey = cert.publicKey;

    // Get public key from private key
    const privatePublicKey = crypto.createPublicKey(privateKey);

    // Export both to compare
    const certPubPem = certPublicKey.export({ type: 'spki', format: 'pem' });
    const privPubPem = privatePublicKey.export({ type: 'spki', format: 'pem' });

    return certPubPem === privPubPem;
  } catch {
    return false;
  }
}

/**
 * Load and parse a private key from the specified source
 */
export function loadPrivateKey(source: PrivateKeySource): crypto.KeyObject {
  const pem = loadPrivateKeyPem(source);
  return parsePrivateKey(pem, source.passphrase);
}

/**
 * Load a private key and verify it matches the given certificate
 */
export function loadAndVerifyPrivateKey(
  source: PrivateKeySource,
  certificatePem: string,
  certificateSubject?: string
): crypto.KeyObject {
  const privateKey = loadPrivateKey(source);

  if (!verifyKeyMatchesCertificate(privateKey, certificatePem)) {
    throw new KeyCertificateMismatchError(
      'Private key does not match the certificate public key',
      { certificateSubject }
    );
  }

  return privateKey;
}

/**
 * Get information about a private key
 */
export interface PrivateKeyInfo {
  type: 'rsa' | 'ec' | 'unknown';
  keySize: number;
  encrypted: boolean;
}

/**
 * Get metadata about a private key
 */
export function getPrivateKeyInfo(privateKey: crypto.KeyObject): PrivateKeyInfo {
  let type: 'rsa' | 'ec' | 'unknown' = 'unknown';
  let keySize = 0;

  if (privateKey.asymmetricKeyType === 'rsa') {
    type = 'rsa';
    const details = privateKey.asymmetricKeyDetails;
    keySize = details?.modulusLength ?? 0;
  } else if (privateKey.asymmetricKeyType === 'ec') {
    type = 'ec';
    const details = privateKey.asymmetricKeyDetails;
    const curve = details?.namedCurve;
    if (curve === 'prime256v1' || curve === 'P-256') keySize = 256;
    else if (curve === 'secp384r1' || curve === 'P-384') keySize = 384;
    else if (curve === 'secp521r1' || curve === 'P-521') keySize = 521;
  }

  return {
    type,
    keySize,
    encrypted: false // We can't determine this after parsing
  };
}
