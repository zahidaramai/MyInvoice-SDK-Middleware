import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SigningConfigSchema,
  CertificateSourceSchema,
  PrivateKeySourceSchema,
  PKCS12SourceSchema,
  loadSigningConfig,
  validateSigningConfig,
  SIGNING_ENV_VARS
} from './config.js';

describe('CertificateSourceSchema', () => {
  it('accepts valid file path source', () => {
    const result = CertificateSourceSchema.parse({ path: '/path/to/cert.pem' });
    expect(result.path).toBe('/path/to/cert.pem');
  });

  it('accepts valid env var source', () => {
    const result = CertificateSourceSchema.parse({ envVar: 'MY_CERT' });
    expect(result.envVar).toBe('MY_CERT');
  });

  it('accepts valid base64 source', () => {
    const result = CertificateSourceSchema.parse({ base64: 'LS0tLS1CRUdJTi...' });
    expect(result.base64).toBe('LS0tLS1CRUdJTi...');
  });

  it('rejects when no source is specified', () => {
    expect(() => CertificateSourceSchema.parse({})).toThrow(
      'Exactly one certificate source must be specified'
    );
  });

  it('rejects when multiple sources are specified', () => {
    expect(() =>
      CertificateSourceSchema.parse({
        path: '/path/to/cert.pem',
        base64: 'LS0tLS1CRUdJTi...'
      })
    ).toThrow('Exactly one certificate source must be specified');
  });
});

describe('PrivateKeySourceSchema', () => {
  it('accepts valid file path source', () => {
    const result = PrivateKeySourceSchema.parse({ path: '/path/to/key.pem' });
    expect(result.path).toBe('/path/to/key.pem');
  });

  it('accepts valid file path source with passphrase', () => {
    const result = PrivateKeySourceSchema.parse({
      path: '/path/to/key.pem',
      passphrase: 'secret'
    });
    expect(result.path).toBe('/path/to/key.pem');
    expect(result.passphrase).toBe('secret');
  });

  it('accepts valid base64 source with passphrase', () => {
    const result = PrivateKeySourceSchema.parse({
      base64: 'LS0tLS1CRUdJTi...',
      passphrase: 'secret'
    });
    expect(result.base64).toBe('LS0tLS1CRUdJTi...');
    expect(result.passphrase).toBe('secret');
  });

  it('rejects when no source is specified', () => {
    expect(() => PrivateKeySourceSchema.parse({})).toThrow(
      'Exactly one private key source must be specified'
    );
  });

  it('rejects when multiple sources are specified', () => {
    expect(() =>
      PrivateKeySourceSchema.parse({
        path: '/path/to/key.pem',
        envVar: 'MY_KEY'
      })
    ).toThrow('Exactly one private key source must be specified');
  });
});

describe('PKCS12SourceSchema', () => {
  it('accepts valid file path source', () => {
    const result = PKCS12SourceSchema.parse({ path: '/path/to/cert.p12' });
    expect(result.path).toBe('/path/to/cert.p12');
  });

  it('accepts valid file path source with passphrase', () => {
    const result = PKCS12SourceSchema.parse({
      path: '/path/to/cert.p12',
      passphrase: 'secret'
    });
    expect(result.path).toBe('/path/to/cert.p12');
    expect(result.passphrase).toBe('secret');
  });

  it('accepts valid base64 source', () => {
    const result = PKCS12SourceSchema.parse({ base64: 'MIIKEQIBAzCCCdc...' });
    expect(result.base64).toBe('MIIKEQIBAzCCCdc...');
  });

  it('accepts valid base64 source with passphrase', () => {
    const result = PKCS12SourceSchema.parse({
      base64: 'MIIKEQIBAzCCCdc...',
      passphrase: 'secret'
    });
    expect(result.base64).toBe('MIIKEQIBAzCCCdc...');
    expect(result.passphrase).toBe('secret');
  });

  it('rejects when no source is specified', () => {
    expect(() => PKCS12SourceSchema.parse({})).toThrow(
      'Exactly one PKCS#12 source must be specified'
    );
  });

  it('rejects when multiple sources are specified', () => {
    expect(() =>
      PKCS12SourceSchema.parse({
        path: '/path/to/cert.p12',
        base64: 'MIIKEQIBAzCCCdc...'
      })
    ).toThrow('Exactly one PKCS#12 source must be specified');
  });
});

describe('SigningConfigSchema', () => {
  it('accepts disabled config without certificate/key', () => {
    const result = SigningConfigSchema.parse({ enabled: false });
    expect(result.enabled).toBe(false);
    expect(result.defaultVersion).toBe('1.0');
  });

  it('accepts enabled config with certificate and key', () => {
    const result = SigningConfigSchema.parse({
      enabled: true,
      certificate: { path: '/path/to/cert.pem' },
      privateKey: { path: '/path/to/key.pem' }
    });
    expect(result.enabled).toBe(true);
    expect(result.certificate?.path).toBe('/path/to/cert.pem');
    expect(result.privateKey?.path).toBe('/path/to/key.pem');
  });

  it('rejects enabled config without certificate', () => {
    expect(() =>
      SigningConfigSchema.parse({
        enabled: true,
        privateKey: { path: '/path/to/key.pem' }
      })
    ).toThrow('When signing is enabled, either pkcs12 OR both certificate and privateKey must be configured');
  });

  it('rejects enabled config without private key', () => {
    expect(() =>
      SigningConfigSchema.parse({
        enabled: true,
        certificate: { path: '/path/to/cert.pem' }
      })
    ).toThrow('When signing is enabled, either pkcs12 OR both certificate and privateKey must be configured');
  });

  it('accepts config with rotation', () => {
    const result = SigningConfigSchema.parse({
      enabled: true,
      certificate: { path: '/path/to/cert.pem' },
      privateKey: { path: '/path/to/key.pem' },
      rotation: {
        certificate: { path: '/path/to/cert2.pem' },
        privateKey: { path: '/path/to/key2.pem' }
      }
    });
    expect(result.rotation?.certificate?.path).toBe('/path/to/cert2.pem');
    expect(result.rotation?.privateKey?.path).toBe('/path/to/key2.pem');
  });

  it('accepts valid document versions', () => {
    const result1 = SigningConfigSchema.parse({
      enabled: false,
      defaultVersion: '1.0'
    });
    expect(result1.defaultVersion).toBe('1.0');

    const result2 = SigningConfigSchema.parse({
      enabled: false,
      defaultVersion: '1.1'
    });
    expect(result2.defaultVersion).toBe('1.1');
  });

  it('rejects invalid document version', () => {
    expect(() =>
      SigningConfigSchema.parse({
        enabled: false,
        defaultVersion: '2.0'
      })
    ).toThrow();
  });

  it('accepts enabled config with pkcs12', () => {
    const result = SigningConfigSchema.parse({
      enabled: true,
      pkcs12: { path: '/path/to/cert.p12', passphrase: 'secret' }
    });
    expect(result.enabled).toBe(true);
    expect(result.pkcs12?.path).toBe('/path/to/cert.p12');
    expect(result.pkcs12?.passphrase).toBe('secret');
  });

  it('accepts enabled config with pkcs12 base64', () => {
    const result = SigningConfigSchema.parse({
      enabled: true,
      pkcs12: { base64: 'MIIKEQIBAzCCCdc...', passphrase: 'secret' }
    });
    expect(result.enabled).toBe(true);
    expect(result.pkcs12?.base64).toBe('MIIKEQIBAzCCCdc...');
  });

  it('rejects config with both pkcs12 and certificate', () => {
    expect(() =>
      SigningConfigSchema.parse({
        enabled: true,
        pkcs12: { path: '/path/to/cert.p12' },
        certificate: { path: '/path/to/cert.pem' }
      })
    ).toThrow('Cannot specify both pkcs12 and separate certificate/privateKey');
  });

  it('rejects config with both pkcs12 and privateKey', () => {
    expect(() =>
      SigningConfigSchema.parse({
        enabled: true,
        pkcs12: { path: '/path/to/cert.p12' },
        privateKey: { path: '/path/to/key.pem' }
      })
    ).toThrow('Cannot specify both pkcs12 and separate certificate/privateKey');
  });
});

describe('loadSigningConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads disabled config from empty env', () => {
    const config = loadSigningConfig();
    expect(config.enabled).toBe(false);
    expect(config.defaultVersion).toBe('1.0');
  });

  it('loads enabled config from env with file paths', () => {
    process.env[SIGNING_ENV_VARS.ENABLED] = 'true';
    process.env[SIGNING_ENV_VARS.CERT_PATH] = '/path/to/cert.pem';
    process.env[SIGNING_ENV_VARS.KEY_PATH] = '/path/to/key.pem';

    const config = loadSigningConfig();
    expect(config.enabled).toBe(true);
    expect(config.certificate?.path).toBe('/path/to/cert.pem');
    expect(config.privateKey?.path).toBe('/path/to/key.pem');
  });

  it('loads config from env with base64', () => {
    process.env[SIGNING_ENV_VARS.ENABLED] = 'true';
    process.env[SIGNING_ENV_VARS.CERT_BASE64] = 'Y2VydA==';
    process.env[SIGNING_ENV_VARS.KEY_BASE64] = 'a2V5';

    const config = loadSigningConfig();
    expect(config.certificate?.base64).toBe('Y2VydA==');
    expect(config.privateKey?.base64).toBe('a2V5');
  });

  it('loads config with passphrase', () => {
    process.env[SIGNING_ENV_VARS.ENABLED] = 'true';
    process.env[SIGNING_ENV_VARS.CERT_PATH] = '/path/to/cert.pem';
    process.env[SIGNING_ENV_VARS.KEY_PATH] = '/path/to/key.pem';
    process.env[SIGNING_ENV_VARS.KEY_PASSPHRASE] = 'secret';

    const config = loadSigningConfig();
    expect(config.privateKey?.passphrase).toBe('secret');
  });

  it('loads config with document version', () => {
    process.env[SIGNING_ENV_VARS.DEFAULT_VERSION] = '1.1';

    const config = loadSigningConfig();
    expect(config.defaultVersion).toBe('1.1');
  });

  it('loads config with rotation', () => {
    process.env[SIGNING_ENV_VARS.ENABLED] = 'true';
    process.env[SIGNING_ENV_VARS.CERT_PATH] = '/path/to/cert.pem';
    process.env[SIGNING_ENV_VARS.KEY_PATH] = '/path/to/key.pem';
    process.env[SIGNING_ENV_VARS.CERT_PATH_2] = '/path/to/cert2.pem';
    process.env[SIGNING_ENV_VARS.KEY_PATH_2] = '/path/to/key2.pem';

    const config = loadSigningConfig();
    expect(config.rotation?.certificate?.path).toBe('/path/to/cert2.pem');
    expect(config.rotation?.privateKey?.path).toBe('/path/to/key2.pem');
  });

  it('loads config from env with pkcs12 path', () => {
    process.env[SIGNING_ENV_VARS.ENABLED] = 'true';
    process.env[SIGNING_ENV_VARS.PKCS12_PATH] = '/path/to/cert.p12';
    process.env[SIGNING_ENV_VARS.PKCS12_PASSPHRASE] = 'secret';

    const config = loadSigningConfig();
    expect(config.enabled).toBe(true);
    expect(config.pkcs12?.path).toBe('/path/to/cert.p12');
    expect(config.pkcs12?.passphrase).toBe('secret');
    expect(config.certificate).toBeUndefined();
    expect(config.privateKey).toBeUndefined();
  });

  it('loads config from env with pkcs12 base64', () => {
    process.env[SIGNING_ENV_VARS.ENABLED] = 'true';
    process.env[SIGNING_ENV_VARS.PKCS12_BASE64] = 'MIIKEQIBAzCCCdc...';
    process.env[SIGNING_ENV_VARS.PKCS12_PASSPHRASE] = 'secret';

    const config = loadSigningConfig();
    expect(config.enabled).toBe(true);
    expect(config.pkcs12?.base64).toBe('MIIKEQIBAzCCCdc...');
    expect(config.pkcs12?.passphrase).toBe('secret');
  });

  it('prioritizes pkcs12 over separate cert/key', () => {
    process.env[SIGNING_ENV_VARS.ENABLED] = 'true';
    process.env[SIGNING_ENV_VARS.PKCS12_PATH] = '/path/to/cert.p12';
    process.env[SIGNING_ENV_VARS.CERT_PATH] = '/path/to/cert.pem';
    process.env[SIGNING_ENV_VARS.KEY_PATH] = '/path/to/key.pem';

    const config = loadSigningConfig();
    expect(config.pkcs12?.path).toBe('/path/to/cert.p12');
    expect(config.certificate).toBeUndefined();
    expect(config.privateKey).toBeUndefined();
  });
});

describe('validateSigningConfig', () => {
  it('validates valid config', () => {
    const config = validateSigningConfig({
      enabled: false,
      defaultVersion: '1.0'
    });
    expect(config.enabled).toBe(false);
  });

  it('throws on invalid config', () => {
    expect(() =>
      validateSigningConfig({
        enabled: true
        // Missing certificate and privateKey
      })
    ).toThrow();
  });
});
