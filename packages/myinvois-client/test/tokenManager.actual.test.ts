/**
 * Actual tests for TokenManager that import and test the real class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager, createTokenManager } from "../src/tokenManager.js";
import type { SessionCredentials } from "../src/types.js";
import * as identity from "../src/identity.js";

// Mock the identity module
vi.mock("../src/identity.js", () => ({
  login: vi.fn(),
}));

describe("TokenManager (actual)", () => {
  let mockSession: SessionCredentials;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSession = {
      sessionId: "test-session-id",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      env: "SANDBOX",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates instance with default options", () => {
      const manager = new TokenManager();
      expect(manager).toBeInstanceOf(TokenManager);
      expect(manager.size()).toBe(0);
    });

    it("creates instance with custom options", () => {
      const mockRateLimiter = { consume: vi.fn() };
      const manager = new TokenManager({
        rateLimiter: mockRateLimiter as any,
        renewSkewMs: 60000,
        maxCacheSize: 500,
      });
      expect(manager).toBeInstanceOf(TokenManager);
    });
  });

  describe("getToken", () => {
    it("returns cached token if still valid", async () => {
      const manager = new TokenManager();
      const futureExpiry = Date.now() + 3600000; // 1 hour from now

      // First call - will login
      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "cached-token",
          expiresAtMs: futureExpiry,
        },
        meta: {},
      });

      const result1 = await manager.getToken(mockSession);
      expect(result1.ok).toBe(true);
      expect(identity.login).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await manager.getToken(mockSession);
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.token.accessToken).toBe("cached-token");
      }
      expect(identity.login).toHaveBeenCalledTimes(1); // Still 1, no new login
    });

    it("refreshes token when expired", async () => {
      const manager = new TokenManager();
      const pastExpiry = Date.now() - 1000; // Already expired
      const futureExpiry = Date.now() + 3600000;

      // First call - returns expired token
      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "expired-token",
          expiresAtMs: pastExpiry,
        },
        meta: {},
      });

      await manager.getToken(mockSession);

      // Second call - should login again because token is expired
      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "new-token",
          expiresAtMs: futureExpiry,
        },
        meta: {},
      });

      const result = await manager.getToken(mockSession);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.token.accessToken).toBe("new-token");
      }
      expect(identity.login).toHaveBeenCalledTimes(2);
    });

    it("returns error when login fails", async () => {
      const manager = new TokenManager();

      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: false,
        error: {
          status: 401,
          message: "Invalid credentials",
          code: "LOGIN_FAILED",
        },
      });

      const result = await manager.getToken(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOGIN_FAILED");
      }
    });

    it("deduplicates concurrent token requests", async () => {
      const manager = new TokenManager();
      const futureExpiry = Date.now() + 3600000;

      // Create a delayed login response
      let resolveLogin: (value: any) => void;
      const loginPromise = new Promise((resolve) => {
        resolveLogin = resolve;
      });

      vi.mocked(identity.login).mockReturnValueOnce(loginPromise as any);

      // Start two concurrent requests
      const request1 = manager.getToken(mockSession);
      const request2 = manager.getToken(mockSession);

      // Resolve the login
      resolveLogin!({
        ok: true,
        token: {
          accessToken: "shared-token",
          expiresAtMs: futureExpiry,
        },
        meta: {},
      });

      const [result1, result2] = await Promise.all([request1, request2]);

      // Both should succeed with the same token
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.token.accessToken).toBe("shared-token");
        expect(result2.token.accessToken).toBe("shared-token");
      }

      // Login should only be called once
      expect(identity.login).toHaveBeenCalledTimes(1);
    });

    it("passes rateLimiter to login", async () => {
      const mockRateLimiter = { consume: vi.fn() };
      const manager = new TokenManager({ rateLimiter: mockRateLimiter as any });

      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "test-token",
          expiresAtMs: Date.now() + 3600000,
        },
        meta: {},
      });

      await manager.getToken(mockSession);

      expect(identity.login).toHaveBeenCalledWith(
        mockSession,
        expect.objectContaining({
          rateLimiter: mockRateLimiter,
        })
      );
    });

    it("passes renewSkewMs to login", async () => {
      const manager = new TokenManager({ renewSkewMs: 60000 });

      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "test-token",
          expiresAtMs: Date.now() + 3600000,
        },
        meta: {},
      });

      await manager.getToken(mockSession);

      expect(identity.login).toHaveBeenCalledWith(
        mockSession,
        expect.objectContaining({
          renewSkewMs: 60000,
        })
      );
    });

    it("cleans up expired tokens when cache is full", async () => {
      const manager = new TokenManager({ maxCacheSize: 2 });
      const pastExpiry = Date.now() - 1000;
      const futureExpiry = Date.now() + 3600000;

      // Fill cache with expired tokens
      const session1: SessionCredentials = { ...mockSession, sessionId: "session-1" };
      const session2: SessionCredentials = { ...mockSession, sessionId: "session-2" };

      vi.mocked(identity.login)
        .mockResolvedValueOnce({
          ok: true,
          token: { accessToken: "token-1", expiresAtMs: pastExpiry },
          meta: {},
        })
        .mockResolvedValueOnce({
          ok: true,
          token: { accessToken: "token-2", expiresAtMs: pastExpiry },
          meta: {},
        })
        .mockResolvedValueOnce({
          ok: true,
          token: { accessToken: "token-3", expiresAtMs: futureExpiry },
          meta: {},
        });

      await manager.getToken(session1);
      await manager.getToken(session2);

      // Cache should be at max size (2)
      expect(manager.size()).toBe(2);

      // Add another token - should trigger cleanup
      const session3: SessionCredentials = { ...mockSession, sessionId: "session-3" };
      await manager.getToken(session3);

      // Expired tokens should be cleaned up
      expect(manager.size()).toBeLessThanOrEqual(2);
    });
  });

  describe("refreshToken", () => {
    it("invalidates cache and gets new token", async () => {
      const manager = new TokenManager();
      const futureExpiry = Date.now() + 3600000;

      // First token
      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "original-token",
          expiresAtMs: futureExpiry,
        },
        meta: {},
      });

      await manager.getToken(mockSession);
      expect(manager.hasValidToken(mockSession.sessionId)).toBe(true);

      // Refresh
      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "refreshed-token",
          expiresAtMs: futureExpiry,
        },
        meta: {},
      });

      const result = await manager.refreshToken(mockSession);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.token.accessToken).toBe("refreshed-token");
      }
      expect(identity.login).toHaveBeenCalledTimes(2);
    });

    it("returns error when refresh fails", async () => {
      const manager = new TokenManager();

      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: false,
        error: {
          status: 500,
          message: "Server error",
          code: "SERVER_ERROR",
        },
      });

      const result = await manager.refreshToken(mockSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("SERVER_ERROR");
      }
    });
  });

  describe("invalidate", () => {
    it("removes token from cache", async () => {
      const manager = new TokenManager();
      const futureExpiry = Date.now() + 3600000;

      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "test-token",
          expiresAtMs: futureExpiry,
        },
        meta: {},
      });

      await manager.getToken(mockSession);
      expect(manager.hasValidToken(mockSession.sessionId)).toBe(true);

      manager.invalidate(mockSession.sessionId);

      expect(manager.hasValidToken(mockSession.sessionId)).toBe(false);
    });

    it("handles invalidating non-existent session", () => {
      const manager = new TokenManager();

      // Should not throw
      expect(() => {
        manager.invalidate("non-existent-session");
      }).not.toThrow();
    });
  });

  describe("clear", () => {
    it("removes all tokens from cache", async () => {
      const manager = new TokenManager();
      const futureExpiry = Date.now() + 3600000;

      const session1: SessionCredentials = { ...mockSession, sessionId: "session-1" };
      const session2: SessionCredentials = { ...mockSession, sessionId: "session-2" };

      vi.mocked(identity.login)
        .mockResolvedValueOnce({
          ok: true,
          token: { accessToken: "token-1", expiresAtMs: futureExpiry },
          meta: {},
        })
        .mockResolvedValueOnce({
          ok: true,
          token: { accessToken: "token-2", expiresAtMs: futureExpiry },
          meta: {},
        });

      await manager.getToken(session1);
      await manager.getToken(session2);
      expect(manager.size()).toBe(2);

      manager.clear();

      expect(manager.size()).toBe(0);
      expect(manager.hasValidToken("session-1")).toBe(false);
      expect(manager.hasValidToken("session-2")).toBe(false);
    });
  });

  describe("hasValidToken", () => {
    it("returns true for valid cached token", async () => {
      const manager = new TokenManager();
      const futureExpiry = Date.now() + 3600000;

      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "valid-token",
          expiresAtMs: futureExpiry,
        },
        meta: {},
      });

      await manager.getToken(mockSession);

      expect(manager.hasValidToken(mockSession.sessionId)).toBe(true);
    });

    it("returns false for expired cached token", async () => {
      const manager = new TokenManager();
      const pastExpiry = Date.now() - 1000;

      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: {
          accessToken: "expired-token",
          expiresAtMs: pastExpiry,
        },
        meta: {},
      });

      await manager.getToken(mockSession);

      expect(manager.hasValidToken(mockSession.sessionId)).toBe(false);
    });

    it("returns false for non-existent session", () => {
      const manager = new TokenManager();

      expect(manager.hasValidToken("non-existent")).toBe(false);
    });
  });

  describe("size", () => {
    it("returns current cache size", async () => {
      const manager = new TokenManager();
      const futureExpiry = Date.now() + 3600000;

      expect(manager.size()).toBe(0);

      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: { accessToken: "token-1", expiresAtMs: futureExpiry },
        meta: {},
      });

      await manager.getToken(mockSession);
      expect(manager.size()).toBe(1);

      const session2: SessionCredentials = { ...mockSession, sessionId: "session-2" };
      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: true,
        token: { accessToken: "token-2", expiresAtMs: futureExpiry },
        meta: {},
      });

      await manager.getToken(session2);
      expect(manager.size()).toBe(2);
    });
  });

  describe("createTokenManager factory", () => {
    it("creates TokenManager instance without options", () => {
      const manager = createTokenManager();
      expect(manager).toBeInstanceOf(TokenManager);
    });

    it("creates TokenManager instance with options", () => {
      const manager = createTokenManager({
        renewSkewMs: 45000,
        maxCacheSize: 200,
      });
      expect(manager).toBeInstanceOf(TokenManager);
    });
  });

  describe("different sessions", () => {
    it("caches tokens separately for different sessionIds", async () => {
      const manager = new TokenManager();
      const futureExpiry = Date.now() + 3600000;

      const session1: SessionCredentials = { ...mockSession, sessionId: "session-1" };
      const session2: SessionCredentials = { ...mockSession, sessionId: "session-2" };

      vi.mocked(identity.login)
        .mockResolvedValueOnce({
          ok: true,
          token: { accessToken: "token-for-session-1", expiresAtMs: futureExpiry },
          meta: {},
        })
        .mockResolvedValueOnce({
          ok: true,
          token: { accessToken: "token-for-session-2", expiresAtMs: futureExpiry },
          meta: {},
        });

      const result1 = await manager.getToken(session1);
      const result2 = await manager.getToken(session2);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.token.accessToken).toBe("token-for-session-1");
        expect(result2.token.accessToken).toBe("token-for-session-2");
      }

      // Verify they are cached separately
      expect(manager.hasValidToken("session-1")).toBe(true);
      expect(manager.hasValidToken("session-2")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("does not cache failed login attempts", async () => {
      const manager = new TokenManager();

      vi.mocked(identity.login).mockResolvedValueOnce({
        ok: false,
        error: {
          status: 401,
          message: "Invalid credentials",
          code: "LOGIN_FAILED",
        },
      });

      await manager.getToken(mockSession);

      expect(manager.hasValidToken(mockSession.sessionId)).toBe(false);
      expect(manager.size()).toBe(0);
    });

    it("cleans up in-flight request tracking after error", async () => {
      const manager = new TokenManager();

      vi.mocked(identity.login)
        .mockResolvedValueOnce({
          ok: false,
          error: {
            status: 500,
            message: "Server error",
            code: "SERVER_ERROR",
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          token: {
            accessToken: "success-token",
            expiresAtMs: Date.now() + 3600000,
          },
          meta: {},
        });

      // First request fails
      const result1 = await manager.getToken(mockSession);
      expect(result1.ok).toBe(false);

      // Second request should work (not be blocked by first request)
      const result2 = await manager.getToken(mockSession);
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.token.accessToken).toBe("success-token");
      }
    });
  });
});
