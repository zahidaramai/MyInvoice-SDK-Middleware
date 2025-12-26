import { describe, it, expect, beforeEach } from "vitest";
import {
  getPackageInfo,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  resolveIdentityBaseUrl,
  resolveSystemBaseUrl,
  isValidEnvironment,
  isValidMode,
  InMemoryRateLimiter,
  sha256,
  sha256Short,
  sessionFingerprint,
  redact,
  redactPartial,
  redactSensitive,
  nowMs,
  isExpired,
  expiresAtFromExpiresIn,
} from "./index.js";

describe("@myinvois/core", () => {
  it("should return package info", () => {
    const info = getPackageInfo();
    expect(info.name).toBe(PACKAGE_NAME);
    expect(info.version).toBe(PACKAGE_VERSION);
  });

  it("should export correct package name", () => {
    expect(PACKAGE_NAME).toBe("@myinvois/core");
  });

  it("should export correct package version", () => {
    expect(PACKAGE_VERSION).toBe("0.1.0");
  });
});

describe("env", () => {
  it("resolves PROD identity URL", () => {
    expect(resolveIdentityBaseUrl("PROD")).toBe("https://api.myinvois.hasil.gov.my");
  });

  it("resolves SANDBOX identity URL", () => {
    expect(resolveIdentityBaseUrl("SANDBOX")).toBe("https://preprod-api.myinvois.hasil.gov.my");
  });

  it("resolves PROD system URL", () => {
    expect(resolveSystemBaseUrl("PROD")).toBe("https://api.myinvois.hasil.gov.my");
  });

  it("resolves SANDBOX system URL", () => {
    expect(resolveSystemBaseUrl("SANDBOX")).toBe("https://preprod-api.myinvois.hasil.gov.my");
  });

  it("validates environment", () => {
    expect(isValidEnvironment("PROD")).toBe(true);
    expect(isValidEnvironment("SANDBOX")).toBe(true);
    expect(isValidEnvironment("invalid")).toBe(false);
    expect(isValidEnvironment(null)).toBe(false);
  });

  it("validates mode", () => {
    expect(isValidMode("TAXPAYER")).toBe(true);
    expect(isValidMode("INTERMEDIARY")).toBe(true);
    expect(isValidMode("invalid")).toBe(false);
  });
});

describe("rate limiter", () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
  });

  it("allows requests within limit", () => {
    const result = limiter.consume("test-key", 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("rejects requests over limit", () => {
    for (let i = 0; i < 10; i++) {
      limiter.consume("test-key", 10);
    }
    const result = limiter.consume("test-key", 10);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks different keys independently", () => {
    for (let i = 0; i < 10; i++) {
      limiter.consume("key-1", 10);
    }
    const result = limiter.consume("key-2", 10);
    expect(result.allowed).toBe(true);
  });

  it("resets key", () => {
    for (let i = 0; i < 10; i++) {
      limiter.consume("test-key", 10);
    }
    limiter.reset("test-key");
    const result = limiter.consume("test-key", 10);
    expect(result.allowed).toBe(true);
  });

  it("peek does not consume", () => {
    const peek1 = limiter.peek("test-key", 10);
    const peek2 = limiter.peek("test-key", 10);
    expect(peek1.remaining).toBe(10);
    expect(peek2.remaining).toBe(10);
  });
});

describe("crypto", () => {
  it("generates sha256 hash", () => {
    const hash = sha256("test");
    expect(hash).toHaveLength(64);
    expect(hash).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
  });

  it("generates short hash", () => {
    const hash = sha256Short("test", 12);
    expect(hash).toHaveLength(12);
    expect(hash).toBe("9f86d081884c");
  });

  it("generates session fingerprint", () => {
    const fp = sessionFingerprint("PROD", "TAXPAYER", "client123");
    expect(fp).toHaveLength(12);
  });

  it("redacts value", () => {
    expect(redact("secret")).toBe("[REDACTED]");
  });

  it("partially redacts value", () => {
    expect(redactPartial("secret123", 4)).toBe("secr...[REDACTED]");
    expect(redactPartial("abc", 4)).toBe("[REDACTED]");
  });

  it("redacts sensitive fields", () => {
    const obj = { name: "test", clientSecret: "secret", token: "abc" };
    const redacted = redactSensitive(obj);
    expect(redacted.name).toBe("test");
    expect(redacted.clientSecret).toBe("[REDACTED]");
    expect(redacted.token).toBe("[REDACTED]");
  });
});

describe("time", () => {
  it("nowMs returns current time", () => {
    const before = Date.now();
    const now = nowMs();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it("isExpired works correctly", () => {
    expect(isExpired(Date.now() - 1000)).toBe(true);
    expect(isExpired(Date.now() + 10000)).toBe(false);
  });

  it("expiresAtFromExpiresIn calculates correctly", () => {
    const now = Date.now();
    const expiresAt = expiresAtFromExpiresIn(3600, 30000);
    expect(expiresAt).toBeGreaterThan(now + 3500000);
    expect(expiresAt).toBeLessThan(now + 3600000);
  });
});
