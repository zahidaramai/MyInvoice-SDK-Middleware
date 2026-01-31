import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPackageInfo,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  RATE_LIMITS,
  TokenManager,
  login,
} from "./index.js";
import { InMemoryRateLimiter } from "@myinvois/core";

describe("@myinvois/myinvois-client", () => {
  it("should return package info", () => {
    const info = getPackageInfo();
    expect(info.name).toBe(PACKAGE_NAME);
    expect(info.version).toBe(PACKAGE_VERSION);
  });

  it("should export rate limits", () => {
    expect(RATE_LIMITS.LOGIN).toBe(12);
    expect(RATE_LIMITS.SUBMIT).toBe(100);
  });
});

describe("login", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends correct request for TAXPAYER", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ correlationid: "test-123" }),
      json: () =>
        Promise.resolve({
          access_token: "token123",
          token_type: "Bearer",
          expires_in: 3600,
        }),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const result = await login({
      sessionId: "sess_test",
      env: "SANDBOX",
      mode: "TAXPAYER",
      clientId: "client123",
      clientSecret: "secret123",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token.accessToken).toBe("token123");
    }

    expect(fetch).toHaveBeenCalledWith(
      "https://preprod-api.myinvois.hasil.gov.my/connect/token",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      })
    );
  });

  it("sends onbehalfof header for INTERMEDIARY", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          access_token: "token123",
          token_type: "Bearer",
          expires_in: 3600,
        }),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    await login({
      sessionId: "sess_test",
      env: "SANDBOX",
      mode: "INTERMEDIARY",
      clientId: "client123",
      clientSecret: "secret123",
      onBehalfOf: "C12345678901",
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          onbehalfof: "C12345678901",
        }),
      })
    );
  });

  it("handles 401 error", async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          error: "invalid_client",
          error_description: "Invalid credentials",
        }),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const result = await login({
      sessionId: "sess_test",
      env: "SANDBOX",
      mode: "TAXPAYER",
      clientId: "client123",
      clientSecret: "wrong",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(401);
      expect(result.error.code).toBe("INVALID_CREDENTIALS");
    }
  });

  it("respects rate limiter", async () => {
    const rateLimiter = new InMemoryRateLimiter();

    // Exhaust the rate limit
    for (let i = 0; i < 12; i++) {
      rateLimiter.consume("client123", 12);
    }

    const result = await login(
      {
        sessionId: "sess_test",
        env: "SANDBOX",
        mode: "TAXPAYER",
        clientId: "client123",
        clientSecret: "secret123",
      },
      { rateLimiter }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RATE_LIMIT_EXCEEDED");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("TokenManager", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caches token and reuses it", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          access_token: "token123",
          token_type: "Bearer",
          expires_in: 3600,
        }),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const manager = new TokenManager();
    const session = {
      sessionId: "sess_test",
      env: "SANDBOX" as const,
      mode: "TAXPAYER" as const,
      clientId: "client123",
      clientSecret: "secret123",
    };

    const result1 = await manager.getToken(session);
    const result2 = await manager.getToken(session);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes token when invalidated", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          access_token: "token123",
          token_type: "Bearer",
          expires_in: 3600,
        }),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const manager = new TokenManager();
    const session = {
      sessionId: "sess_test",
      env: "SANDBOX" as const,
      mode: "TAXPAYER" as const,
      clientId: "client123",
      clientSecret: "secret123",
    };

    await manager.getToken(session);
    manager.invalidate("sess_test");
    await manager.getToken(session);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("hasValidToken returns correct state", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          access_token: "token123",
          token_type: "Bearer",
          expires_in: 3600,
        }),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const manager = new TokenManager();
    expect(manager.hasValidToken("sess_test")).toBe(false);

    await manager.getToken({
      sessionId: "sess_test",
      env: "SANDBOX",
      mode: "TAXPAYER",
      clientId: "client123",
      clientSecret: "secret123",
    });

    expect(manager.hasValidToken("sess_test")).toBe(true);
  });
});
