import {
  loadSigningConfig,
  loadCertificate,
  loadPrivateKey,
  loadPKCS12,
  verifyKeyMatchesCertificate,
  SigningService,
  PrivateKeyLoadError,
  KeyCertificateMismatchError,
  type SigningConfig,
  type CertificateInfo,
  type DocumentVersion
} from '@myinvois/signing';
import type { KeyObject } from 'crypto';

/**
 * Gateway signing state
 */
export interface SigningState {
  /** Whether signing is enabled */
  enabled: boolean;
  /** Signing service instance (if enabled and configured) */
  service: SigningService | null;
  /** Certificate information (if loaded) */
  certificateInfo: CertificateInfo | null;
  /** Default document version */
  defaultVersion: DocumentVersion;
  /** Error message if signing failed to initialize */
  error?: string;
  /** Warning message (e.g., certificate expiring soon) */
  warning?: string;
}

/** Signing state singleton */
let signingState: SigningState | null = null;

/**
 * Initialize signing service from environment configuration
 * @returns SigningState with service if successful, or error information
 */
export function initializeSigning(logger?: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (obj: unknown, msg: string) => void;
}): SigningState {
  const log = logger || {
    info: console.log,
    warn: console.warn,
    error: (obj: unknown, msg: string) => console.error(msg, obj)
  };

  // Load configuration
  let config: SigningConfig;
  try {
    config = loadSigningConfig();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown configuration error';
    log.info(`Signing disabled: ${errorMessage}`);

    signingState = {
      enabled: false,
      service: null,
      certificateInfo: null,
      defaultVersion: '1.0',
      error: errorMessage
    };
    return signingState;
  }

  // Check if signing is enabled
  if (!config.enabled) {
    log.info('Signing feature disabled via configuration');

    signingState = {
      enabled: false,
      service: null,
      certificateInfo: null,
      defaultVersion: config.defaultVersion || '1.0'
    };
    return signingState;
  }

  // Try to load certificate and key
  let certPem: string;
  let certInfo: CertificateInfo;
  let privateKey: KeyObject;

  try {
    // Check for PKCS#12 source first (contains both cert and key)
    if (config.pkcs12) {
      log.info('Loading certificate and key from PKCS#12...');

      const p12Source = config.pkcs12.path
        ? { path: config.pkcs12.path, passphrase: config.pkcs12.passphrase }
        : config.pkcs12.base64
          ? { base64: config.pkcs12.base64, passphrase: config.pkcs12.passphrase }
          : null;

      if (!p12Source) {
        throw new Error('Invalid PKCS#12 configuration');
      }

      const p12Result = loadPKCS12(p12Source);
      certPem = p12Result.certPem;
      certInfo = p12Result.certInfo;
      privateKey = p12Result.privateKey;

      log.info(`Certificate loaded from PKCS#12: ${certInfo.subject.commonName || certInfo.subject.raw}`);
      log.info(`Certificate valid until: ${certInfo.validTo.toISOString()}`);
      log.info('Private key extracted from PKCS#12');

    } else {
      // Fall back to separate certificate and key files
      if (!config.certificate) {
        throw new Error('No certificate configuration provided');
      }
      const certResult = loadCertificate(config.certificate);
      certPem = certResult.pem;
      certInfo = certResult.info;

      log.info(`Certificate loaded: ${certInfo.subject.commonName || certInfo.subject.raw}`);
      log.info(`Certificate valid until: ${certInfo.validTo.toISOString()}`);

      // Load private key
      if (!config.privateKey) {
        throw new PrivateKeyLoadError('No private key configuration provided');
      }

      const keySource = config.privateKey.path
        ? { path: config.privateKey.path, passphrase: config.privateKey.passphrase }
        : config.privateKey.base64
          ? { base64: config.privateKey.base64, passphrase: config.privateKey.passphrase }
          : null;

      if (!keySource) {
        throw new PrivateKeyLoadError('No private key source configured');
      }

      privateKey = loadPrivateKey(keySource);

      // Verify key matches certificate
      if (!verifyKeyMatchesCertificate(privateKey, certPem)) {
        throw new KeyCertificateMismatchError(
          'Private key does not match certificate',
          { certificateSubject: certInfo.subject.commonName || certInfo.subject.raw }
        );
      }

      log.info('Private key loaded and verified');
    }

    // Check for expiry warning
    let warning: string | undefined;
    if (certInfo.daysUntilExpiry <= 30 && certInfo.daysUntilExpiry > 0) {
      warning = `Certificate expires in ${certInfo.daysUntilExpiry} days`;
      log.warn(warning);
    } else if (certInfo.isExpired) {
      warning = 'Certificate has expired';
      log.warn(warning);
    }

    // Create signing service
    const service = new SigningService(privateKey, certPem, certInfo);

    signingState = {
      enabled: true,
      service,
      certificateInfo: certInfo,
      defaultVersion: config.defaultVersion || '1.1',
      warning
    };

    log.info(`Signing initialized - default version: ${signingState.defaultVersion}`);
    return signingState;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error }, `Signing initialization failed: ${errorMessage}`);

    // Fall back to disabled state
    signingState = {
      enabled: false,
      service: null,
      certificateInfo: null,
      defaultVersion: '1.0',
      error: errorMessage
    };

    return signingState;
  }
}

/**
 * Get current signing state
 * Initializes if not already done
 */
export function getSigningState(): SigningState {
  if (!signingState) {
    return initializeSigning();
  }
  return signingState;
}

/**
 * Get signing service (if available)
 */
export function getSigningService(): SigningService | null {
  return getSigningState().service;
}

/**
 * Check if signing is available
 */
export function isSigningAvailable(): boolean {
  return getSigningState().enabled && getSigningState().service !== null;
}

/**
 * Get default document version
 */
export function getDefaultDocumentVersion(): DocumentVersion {
  return getSigningState().defaultVersion;
}

/**
 * Get signing health status for health check endpoint
 */
export function getSigningHealthStatus(): {
  enabled: boolean;
  certificateValid: boolean;
  certificateExpiry?: string;
  defaultVersion: string;
  warning?: string;
  error?: string;
} {
  const state = getSigningState();

  return {
    enabled: state.enabled,
    certificateValid: state.certificateInfo?.isValid ?? false,
    certificateExpiry: state.certificateInfo?.validTo?.toISOString(),
    defaultVersion: state.defaultVersion,
    warning: state.warning,
    error: state.error
  };
}

/**
 * Reset signing state (for testing)
 */
export function resetSigningState(): void {
  signingState = null;
}
