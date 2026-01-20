import * as crypto from 'crypto';
import * as fs from 'fs';
import type { CertificateSource } from './config.js';
import type { CertificateInfo, DistinguishedName } from './types.js';
import { CertificateLoadError, CertificateExpiredError, CertificateNotYetValidError } from './errors.js';

/**
 * Normalize a Distinguished Name from X.500 order to RFC2253 order
 *
 * Node.js X509Certificate.issuer returns DN in X.500 order: C, O, OU, CN
 * LHDN MyInvois expects RFC2253 format: CN, OU, O, C
 *
 * This function reverses the component order.
 */
function normalizeDistinguishedName(dn: string): string {
  // Split by newline (Node.js format) and filter empty parts
  const parts = dn.split('\n').filter(p => p.trim());
  // Reverse to convert from X.500 (C first) to RFC2253 (CN first)
  const reversedParts = parts.reverse();
  // Join with ", " for RFC2253 format
  return reversedParts.join(', ');
}

/**
 * Parse a distinguished name string into structured components
 * Handles both comma-separated (RFC 2253) and newline-separated (Node.js X509) formats
 *
 * The `raw` field contains the normalized RFC2253 format for use with LHDN MyInvois
 */
function parseDistinguishedName(dn: string): DistinguishedName {
  // Normalize to RFC2253 format (CN first, C last)
  const normalizedDn = normalizeDistinguishedName(dn);
  const result: DistinguishedName = { raw: normalizedDn };

  // Parse common DN components - stop at comma OR newline
  const cnMatch = dn.match(/CN=([^\n,]+)/i);
  if (cnMatch) result.commonName = cnMatch[1].trim();

  const oMatch = dn.match(/O=([^\n,]+)/i);
  if (oMatch) result.organization = oMatch[1].trim();

  const ouMatch = dn.match(/OU=([^\n,]+)/i);
  if (ouMatch) result.organizationalUnit = ouMatch[1].trim();

  const cMatch = dn.match(/C=([^\n,]+)/i);
  if (cMatch) result.country = cMatch[1].trim();

  const stMatch = dn.match(/ST=([^\n,]+)/i);
  if (stMatch) result.state = stMatch[1].trim();

  const lMatch = dn.match(/L=([^\n,]+)/i);
  if (lMatch) result.locality = lMatch[1].trim();

  const emailMatch = dn.match(/emailAddress=([^\n,]+)/i);
  if (emailMatch) result.emailAddress = emailMatch[1].trim();

  return result;
}

/**
 * Load certificate content from a file path
 */
export function loadCertificateFromFile(path: string): string {
  try {
    return fs.readFileSync(path, 'utf-8');
  } catch (error) {
    throw new CertificateLoadError(
      `Failed to load certificate from file: ${path}`,
      { source: 'file', path, cause: error as Error }
    );
  }
}

/**
 * Load certificate content from a base64-encoded string
 */
export function loadCertificateFromBase64(base64Data: string): string {
  try {
    return Buffer.from(base64Data, 'base64').toString('utf-8');
  } catch (error) {
    throw new CertificateLoadError(
      'Failed to decode base64 certificate data',
      { source: 'base64', cause: error as Error }
    );
  }
}

/**
 * Load certificate content from an environment variable
 */
export function loadCertificateFromEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new CertificateLoadError(
      `Environment variable ${envVar} is not set or empty`,
      { source: 'env' }
    );
  }
  return value;
}

/**
 * Load certificate PEM content from the specified source
 */
export function loadCertificatePem(source: CertificateSource): string {
  if (source.path) {
    return loadCertificateFromFile(source.path);
  }
  if (source.base64) {
    return loadCertificateFromBase64(source.base64);
  }
  if (source.envVar) {
    return loadCertificateFromEnv(source.envVar);
  }
  throw new CertificateLoadError('No certificate source specified');
}

/**
 * Parse a PEM-encoded certificate and extract metadata
 */
export function parseCertificate(pemContent: string): CertificateInfo {
  try {
    // Create X509Certificate from PEM
    const cert = new crypto.X509Certificate(pemContent);

    // Parse dates
    const validFrom = new Date(cert.validFrom);
    const validTo = new Date(cert.validTo);
    const now = new Date();

    // Calculate days until expiry
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / msPerDay);

    // Determine validity status
    const isExpired = now > validTo;
    const isNotYetValid = now < validFrom;
    const isValid = !isExpired && !isNotYetValid;

    // Get key info
    const publicKey = cert.publicKey;
    let keyType = 'unknown';
    let keySize = 0;

    if (publicKey.asymmetricKeyType === 'rsa') {
      keyType = 'RSA';
      const keyDetails = publicKey.asymmetricKeyDetails;
      keySize = keyDetails?.modulusLength ?? 0;
    } else if (publicKey.asymmetricKeyType === 'ec') {
      keyType = 'EC';
      const keyDetails = publicKey.asymmetricKeyDetails;
      // EC key size based on curve
      const curve = keyDetails?.namedCurve;
      if (curve === 'prime256v1' || curve === 'P-256') keySize = 256;
      else if (curve === 'secp384r1' || curve === 'P-384') keySize = 384;
      else if (curve === 'secp521r1' || curve === 'P-521') keySize = 521;
    }

    // Parse key usage
    let keyUsage: string[] | undefined;
    try {
      const keyUsageExt = cert.keyUsage;
      if (keyUsageExt && keyUsageExt.length > 0) {
        keyUsage = keyUsageExt;
      }
    } catch {
      // Key usage extension not present
    }

    // Calculate fingerprint
    const fingerprint = crypto
      .createHash('sha256')
      .update(Buffer.from(cert.raw))
      .digest('hex')
      .toUpperCase()
      .match(/.{2}/g)
      ?.join(':') ?? '';

    // Convert serial number from hex to decimal format
    // Node.js returns hex (e.g., "01:23:45:67"), MyInvois expects decimal
    const hexSerial = cert.serialNumber.replace(/:/g, '');
    const decimalSerial = BigInt('0x' + hexSerial).toString();

    return {
      subject: parseDistinguishedName(cert.subject),
      issuer: parseDistinguishedName(cert.issuer),
      serialNumber: decimalSerial,
      validFrom,
      validTo,
      isValid,
      isExpired,
      isNotYetValid,
      daysUntilExpiry,
      fingerprint,
      keyType,
      keySize,
      keyUsage
    };
  } catch (error) {
    if (error instanceof CertificateLoadError) {
      throw error;
    }
    throw new CertificateLoadError(
      'Failed to parse certificate: Invalid PEM format or corrupted data',
      { cause: error as Error }
    );
  }
}

/**
 * Validate certificate is currently valid (not expired, not future)
 */
export function validateCertificate(certInfo: CertificateInfo): void {
  if (certInfo.isExpired) {
    throw new CertificateExpiredError(
      `Certificate expired on ${certInfo.validTo.toISOString()}`,
      certInfo.validTo,
      { subject: certInfo.subject.commonName ?? certInfo.subject.raw }
    );
  }

  if (certInfo.isNotYetValid) {
    throw new CertificateNotYetValidError(
      `Certificate not valid until ${certInfo.validFrom.toISOString()}`,
      certInfo.validFrom,
      { subject: certInfo.subject.commonName ?? certInfo.subject.raw }
    );
  }
}

/**
 * Load and parse a certificate from the specified source
 * Returns the certificate info without validation
 */
export function loadCertificate(source: CertificateSource): {
  pem: string;
  info: CertificateInfo;
} {
  const pem = loadCertificatePem(source);
  const info = parseCertificate(pem);
  return { pem, info };
}

/**
 * Load, parse, and validate a certificate from the specified source
 * Throws if certificate is expired or not yet valid
 */
export function loadAndValidateCertificate(source: CertificateSource): {
  pem: string;
  info: CertificateInfo;
} {
  const result = loadCertificate(source);
  validateCertificate(result.info);
  return result;
}

/**
 * Get the raw X509Certificate object for advanced operations
 */
export function getX509Certificate(pemContent: string): crypto.X509Certificate {
  try {
    return new crypto.X509Certificate(pemContent);
  } catch (error) {
    throw new CertificateLoadError(
      'Failed to create X509Certificate: Invalid PEM format',
      { cause: error as Error }
    );
  }
}
