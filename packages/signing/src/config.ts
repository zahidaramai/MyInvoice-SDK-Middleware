import { z } from 'zod';

/**
 * Certificate source configuration - supports file, env, or base64
 */
export const CertificateSourceSchema = z
  .object({
    /** Load certificate from file path */
    path: z.string().optional(),
    /** Load certificate from environment variable */
    envVar: z.string().optional(),
    /** Load certificate from base64-encoded string */
    base64: z.string().optional()
  })
  .refine(
    (data) => {
      const sources = [data.path, data.envVar, data.base64].filter(Boolean);
      return sources.length === 1;
    },
    {
      message:
        'Exactly one certificate source must be specified: path, envVar, or base64'
    }
  );

export type CertificateSource = z.infer<typeof CertificateSourceSchema>;

/**
 * Private key source configuration - supports file, env, or base64 with optional passphrase
 */
export const PrivateKeySourceSchema = z
  .object({
    /** Load private key from file path */
    path: z.string().optional(),
    /** Load private key from environment variable */
    envVar: z.string().optional(),
    /** Load private key from base64-encoded string */
    base64: z.string().optional(),
    /** Passphrase for encrypted private keys */
    passphrase: z.string().optional()
  })
  .refine(
    (data) => {
      const sources = [data.path, data.envVar, data.base64].filter(Boolean);
      return sources.length === 1;
    },
    {
      message:
        'Exactly one private key source must be specified: path, envVar, or base64'
    }
  );

export type PrivateKeySource = z.infer<typeof PrivateKeySourceSchema>;

/**
 * Document version type
 */
export const DocumentVersionSchema = z.enum(['1.0', '1.1']);
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

/**
 * Certificate rotation configuration (optional)
 */
export const RotationConfigSchema = z
  .object({
    /** Secondary certificate for rotation */
    certificate: CertificateSourceSchema.optional(),
    /** Secondary private key for rotation */
    privateKey: PrivateKeySourceSchema.optional()
  })
  .optional();

export type RotationConfig = z.infer<typeof RotationConfigSchema>;

/**
 * Full signing configuration schema
 */
export const SigningConfigSchema = z.object({
  /** Master switch to enable/disable signing */
  enabled: z.boolean().default(false),
  /** Default document version when not specified per-session */
  defaultVersion: DocumentVersionSchema.default('1.0'),
  /** Primary certificate configuration */
  certificate: CertificateSourceSchema.optional(),
  /** Primary private key configuration */
  privateKey: PrivateKeySourceSchema.optional(),
  /** Optional rotation configuration for zero-downtime certificate updates */
  rotation: RotationConfigSchema
}).refine(
  (data) => {
    // If enabled, certificate and privateKey must be provided
    if (data.enabled) {
      return data.certificate !== undefined && data.privateKey !== undefined;
    }
    return true;
  },
  {
    message: 'When signing is enabled, both certificate and privateKey must be configured'
  }
);

export type SigningConfig = z.infer<typeof SigningConfigSchema>;

/**
 * Environment variable names for signing configuration
 */
export const SIGNING_ENV_VARS = {
  ENABLED: 'SIGNING_ENABLED',
  DEFAULT_VERSION: 'DOCUMENT_VERSION',
  CERT_PATH: 'SIGNING_CERT_PATH',
  CERT_BASE64: 'SIGNING_CERT_BASE64',
  KEY_PATH: 'SIGNING_KEY_PATH',
  KEY_BASE64: 'SIGNING_KEY_BASE64',
  KEY_PASSPHRASE: 'SIGNING_KEY_PASSPHRASE',
  CERT_PATH_2: 'SIGNING_CERT_PATH_2',
  KEY_PATH_2: 'SIGNING_KEY_PATH_2'
} as const;

/**
 * Load signing configuration from environment variables
 */
export function loadSigningConfig(): SigningConfig {
  const env = process.env;

  // Determine certificate source
  let certificate: CertificateSource | undefined;
  if (env[SIGNING_ENV_VARS.CERT_PATH]) {
    certificate = { path: env[SIGNING_ENV_VARS.CERT_PATH] };
  } else if (env[SIGNING_ENV_VARS.CERT_BASE64]) {
    certificate = { base64: env[SIGNING_ENV_VARS.CERT_BASE64] };
  }

  // Determine private key source
  let privateKey: PrivateKeySource | undefined;
  if (env[SIGNING_ENV_VARS.KEY_PATH]) {
    privateKey = {
      path: env[SIGNING_ENV_VARS.KEY_PATH],
      passphrase: env[SIGNING_ENV_VARS.KEY_PASSPHRASE]
    };
  } else if (env[SIGNING_ENV_VARS.KEY_BASE64]) {
    privateKey = {
      base64: env[SIGNING_ENV_VARS.KEY_BASE64],
      passphrase: env[SIGNING_ENV_VARS.KEY_PASSPHRASE]
    };
  }

  // Determine rotation config
  let rotation: RotationConfig | undefined;
  if (env[SIGNING_ENV_VARS.CERT_PATH_2] || env[SIGNING_ENV_VARS.KEY_PATH_2]) {
    rotation = {};
    if (env[SIGNING_ENV_VARS.CERT_PATH_2]) {
      rotation.certificate = { path: env[SIGNING_ENV_VARS.CERT_PATH_2] };
    }
    if (env[SIGNING_ENV_VARS.KEY_PATH_2]) {
      rotation.privateKey = { path: env[SIGNING_ENV_VARS.KEY_PATH_2] };
    }
  }

  const config = {
    enabled: env[SIGNING_ENV_VARS.ENABLED]?.toLowerCase() === 'true',
    defaultVersion: (env[SIGNING_ENV_VARS.DEFAULT_VERSION] as DocumentVersion) || '1.0',
    certificate,
    privateKey,
    rotation
  };

  // Validate and return
  return SigningConfigSchema.parse(config);
}

/**
 * Validate a signing configuration object
 */
export function validateSigningConfig(config: unknown): SigningConfig {
  return SigningConfigSchema.parse(config);
}
