import {
  loadPKCS12,
  SigningService,
  SIGNING_ENV_VARS,
  type CertificateInfo,
  type DocumentVersion,
} from "@myinvois/signing";
import type { KeyObject } from "crypto";
import { isS3Path, downloadFromS3 } from "./s3-loader.js";
import { createComponentLogger } from "../lib/appLogger.js";

// P2-01: Structured logger for signing component
const signingLogger = createComponentLogger("signing");

/**
 * Legacy environment variable names (for backwards compatibility)
 */
const LEGACY_ENV_VARS = {
  PKCS12_PATH: "P12_CERTIFICATE_PATH",
  PKCS12_PASSPHRASE: "P12_CERTIFICATE_PASSWORD",
} as const;

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
 * Get PKCS#12 path from environment (supports legacy and standard env var names)
 */
function getPKCS12PathFromEnv(): string | undefined {
  return process.env[SIGNING_ENV_VARS.PKCS12_PATH] || process.env[LEGACY_ENV_VARS.PKCS12_PATH];
}

/**
 * Get PKCS#12 passphrase from environment (supports legacy and standard env var names)
 */
function getPKCS12PassphraseFromEnv(): string | undefined {
  return (
    process.env[SIGNING_ENV_VARS.PKCS12_PASSPHRASE] ||
    process.env[LEGACY_ENV_VARS.PKCS12_PASSPHRASE]
  );
}

/**
 * Check if signing should be enabled based on environment
 */
function shouldEnableSigning(): boolean {
  // Explicit enable/disable takes precedence
  const explicitEnabled = process.env[SIGNING_ENV_VARS.ENABLED];
  if (explicitEnabled !== undefined) {
    return explicitEnabled.toLowerCase() === "true";
  }

  // Auto-enable if PKCS#12 path is configured
  const pkcs12Path = getPKCS12PathFromEnv();
  return Boolean(pkcs12Path);
}

/**
 * Initialize signing service from environment configuration
 * Supports S3 paths and legacy environment variable names
 * @returns SigningState with service if successful, or error information
 */
export async function initializeSigning(logger?: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (obj: unknown, msg: string) => void;
}): Promise<SigningState> {
  // P2-01: Use structured logger as fallback
  const log = logger || signingLogger;

  // Check if signing should be enabled
  const shouldEnable = shouldEnableSigning();
  const pkcs12Path = getPKCS12PathFromEnv();
  const pkcs12Passphrase = getPKCS12PassphraseFromEnv();
  const defaultVersion =
    (process.env[SIGNING_ENV_VARS.DEFAULT_VERSION] as DocumentVersion) || "1.1";

  if (!shouldEnable) {
    log.info("Signing feature disabled via configuration");
    signingState = {
      enabled: false,
      service: null,
      certificateInfo: null,
      defaultVersion,
    };
    return signingState;
  }

  if (!pkcs12Path) {
    log.info("Signing enabled but no PKCS#12 path configured");
    signingState = {
      enabled: false,
      service: null,
      certificateInfo: null,
      defaultVersion,
      error: "No PKCS#12 path configured (set SIGNING_PKCS12_PATH or P12_CERTIFICATE_PATH)",
    };
    return signingState;
  }

  // Try to load certificate and key
  let certPem: string;
  let certInfo: CertificateInfo;
  let privateKey: KeyObject;

  try {
    log.info(`Loading certificate from: ${pkcs12Path}`);

    // Resolve path (download from S3 if needed)
    let localPath = pkcs12Path;
    if (isS3Path(pkcs12Path)) {
      log.info("Downloading certificate from S3...");
      localPath = await downloadFromS3(pkcs12Path);
      log.info(`Certificate downloaded to: ${localPath}`);
    }

    // Load PKCS#12
    const p12Result = loadPKCS12({
      path: localPath,
      passphrase: pkcs12Passphrase,
    });

    certPem = p12Result.certPem;
    certInfo = p12Result.certInfo;
    privateKey = p12Result.privateKey;

    log.info(
      `Certificate loaded from PKCS#12: ${certInfo.subject.commonName || certInfo.subject.raw}`
    );
    log.info(`Certificate valid until: ${certInfo.validTo.toISOString()}`);
    log.info("Private key extracted from PKCS#12");

    // Check for expiry warning
    let warning: string | undefined;
    if (certInfo.daysUntilExpiry <= 30 && certInfo.daysUntilExpiry > 0) {
      warning = `Certificate expires in ${certInfo.daysUntilExpiry} days`;
      log.warn(warning);
    } else if (certInfo.isExpired) {
      warning = "Certificate has expired";
      log.warn(warning);
    }

    // Create signing service
    const service = new SigningService(privateKey, certPem, certInfo);

    signingState = {
      enabled: true,
      service,
      certificateInfo: certInfo,
      defaultVersion,
      warning,
    };

    log.info(`Signing initialized - default version: ${signingState.defaultVersion}`);
    return signingState;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log.error({ error }, `Signing initialization failed: ${errorMessage}`);

    // Fall back to disabled state
    signingState = {
      enabled: false,
      service: null,
      certificateInfo: null,
      defaultVersion: "1.0",
      error: errorMessage,
    };

    return signingState;
  }
}

/**
 * Get current signing state (sync version)
 * Returns null if not yet initialized - use initializeSigning() first at startup
 */
export function getSigningState(): SigningState {
  if (!signingState) {
    // Return disabled state if not initialized
    return {
      enabled: false,
      service: null,
      certificateInfo: null,
      defaultVersion: "1.0",
      error: "Signing not initialized - call initializeSigning() at startup",
    };
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
    error: state.error,
  };
}

/**
 * Reset signing state (for testing)
 */
export function resetSigningState(): void {
  signingState = null;
}
