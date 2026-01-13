/**
 * PKCS#12 (.p12/.pfx) certificate loader
 *
 * Extracts certificate and private key from PKCS#12 files using node-forge.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import forge from 'node-forge';
import { CertificateLoadError, PrivateKeyLoadError } from './errors.js';
import { parseCertificate } from './certificate-loader.js';
import type { CertificateInfo } from './types.js';

export interface PKCS12Source {
  /** Path to .p12/.pfx file */
  path?: string;
  /** Base64-encoded .p12/.pfx content */
  base64?: string;
  /** Passphrase for the PKCS#12 file */
  passphrase?: string;
}

export interface PKCS12Result {
  /** Certificate in PEM format */
  certPem: string;
  /** Parsed certificate info */
  certInfo: CertificateInfo;
  /** Private key as KeyObject */
  privateKey: crypto.KeyObject;
}

/**
 * Load certificate and private key from a PKCS#12 file
 */
export function loadPKCS12(source: PKCS12Source): PKCS12Result {
  let p12Buffer: Buffer;

  // Load the PKCS#12 data
  if (source.path) {
    try {
      p12Buffer = fs.readFileSync(source.path);
    } catch (error) {
      throw new CertificateLoadError(
        `Failed to read PKCS#12 file: ${source.path} - ${(error as Error).message}`
      );
    }
  } else if (source.base64) {
    try {
      p12Buffer = Buffer.from(source.base64, 'base64');
    } catch (error) {
      throw new CertificateLoadError(
        `Failed to decode base64 PKCS#12 data: ${(error as Error).message}`
      );
    }
  } else {
    throw new CertificateLoadError(
      'PKCS#12 source must specify either path or base64'
    );
  }

  const passphrase = source.passphrase || '';

  // Parse PKCS#12 using node-forge
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const p12Der = p12Buffer.toString('binary');
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('Invalid password') || message.includes('PKCS#12 MAC could not be verified')) {
      throw new PrivateKeyLoadError(
        'Invalid PKCS#12 passphrase or corrupted file'
      );
    }
    throw new CertificateLoadError(
      `Failed to parse PKCS#12: ${message}`
    );
  }

  // Extract certificate
  let certificate: forge.pki.Certificate | undefined;
  try {
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBagArray = certBags[forge.pki.oids.certBag];
    if (certBagArray && certBagArray.length > 0) {
      certificate = certBagArray[0].cert;
    }
  } catch (error) {
    throw new CertificateLoadError(
      `Failed to extract certificate from PKCS#12: ${(error as Error).message}`
    );
  }

  if (!certificate) {
    throw new CertificateLoadError(
      'No certificate found in PKCS#12 file'
    );
  }

  // Convert certificate to PEM
  const certPem = forge.pki.certificateToPem(certificate);

  // Parse certificate info using our existing parser
  let certInfo: CertificateInfo;
  try {
    certInfo = parseCertificate(certPem);
  } catch (error) {
    throw new CertificateLoadError(
      `Failed to parse extracted certificate: ${(error as Error).message}`
    );
  }

  // Extract private key
  let forgePrivateKey: forge.pki.PrivateKey | undefined;
  try {
    // Try pkcs8ShroudedKeyBag first (encrypted key)
    const shroudedKeyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const shroudedBagArray = shroudedKeyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
    if (shroudedBagArray && shroudedBagArray.length > 0) {
      forgePrivateKey = shroudedBagArray[0].key;
    }

    // If not found, try keyBag (unencrypted key)
    if (!forgePrivateKey) {
      const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
      const keyBagArray = keyBags[forge.pki.oids.keyBag];
      if (keyBagArray && keyBagArray.length > 0) {
        forgePrivateKey = keyBagArray[0].key;
      }
    }
  } catch (error) {
    throw new PrivateKeyLoadError(
      `Failed to extract private key from PKCS#12: ${(error as Error).message}`
    );
  }

  if (!forgePrivateKey) {
    throw new PrivateKeyLoadError(
      'No private key found in PKCS#12 file'
    );
  }

  // Convert forge private key to PEM, then to Node.js KeyObject
  let privateKey: crypto.KeyObject;
  try {
    const keyPem = forge.pki.privateKeyToPem(forgePrivateKey);
    privateKey = crypto.createPrivateKey({
      key: keyPem,
      format: 'pem'
    });
  } catch (error) {
    throw new PrivateKeyLoadError(
      `Failed to convert private key: ${(error as Error).message}`
    );
  }

  return {
    certPem,
    certInfo,
    privateKey
  };
}

/**
 * Check if a file is a PKCS#12 file based on extension
 */
export function isPKCS12File(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.p12') || lower.endsWith('.pfx');
}

/**
 * Load from PKCS#12 file path
 */
export function loadPKCS12FromFile(path: string, passphrase?: string): PKCS12Result {
  return loadPKCS12({ path, passphrase });
}

/**
 * Load from base64-encoded PKCS#12
 */
export function loadPKCS12FromBase64(base64: string, passphrase?: string): PKCS12Result {
  return loadPKCS12({ base64, passphrase });
}
