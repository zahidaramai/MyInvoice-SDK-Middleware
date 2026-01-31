/**
 * TST-01: Authentication API Tests
 * Tests for login, logout, refresh, me endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import * as storage from "@myinvois/storage";
import * as password from "../src/auth/password.js";

// Mock storage functions
vi.mock("@myinvois/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@myinvois/storage")>();
  return {
    ...original,
    findUserByEmailWithCompanies: vi.fn(),
    findUserByIdWithCompanies: vi.fn(),
    createRefreshToken: vi.fn(),
    findValidRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn(),
    revokeAllUserTokens: vi.fn(),
    parsePermissions: vi.fn().mockReturnValue(["submit:invoice", "read:documents"]),
  };
});

// Mock poll queue
vi.mock("../src/lib/pollQueue.js", () => ({
  POLL_QUEUE_NAME: "poll-submission",
  MIN_POLL_INTERVAL_MS: 3000,
  enqueuePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
  enqueueImmediatePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
  calculatePollDelay: vi.fn().mockReturnValue(3000),
  closePollQueue: vi.fn().mockResolvedValue(undefined),
  getPollQueueStats: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
}));

// Mock password verification
vi.mock("../src/auth/password.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/auth/password.js")>();
  return {
    ...original,
    verifyPassword: vi.fn(),
  };
});

// Mock JWT functions for testing
vi.mock("../src/auth/jwt.js", () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token === "valid-test-token") {
      return {
        userId: "user-123",
        email: "test@example.com",
        companyId: "company-123",
        permissions: ["submit:invoice", "read:documents"],
        type: "access",
      };
    }
    throw new Error("Invalid token");
  }),
  verifyPosToken: vi.fn(() => {
    throw new Error("Not a POS token");
  }),
  verifyRefreshToken: vi.fn((token: string) => {
    if (token === "valid-refresh-token") {
      return {
        userId: "user-123",
        tokenId: "token-id-123",
        type: "refresh",
      };
    }
    throw new Error("Invalid refresh token");
  }),
  createTokenPair: vi.fn(() => ({
    accessToken: "mock-access-token",
    refreshToken: "mock-refresh-token",
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    refreshTokenId: "mock-token-id",
  })),
  createAccessToken: vi.fn(() => ({
    token: "mock-access-token",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  })),
  hashRefreshToken: vi.fn((token: string) => `hashed-${token}`),
}));

// Sample test data
const mockUser = {
  id: "user-123",
  email: "test@example.com",
  passwordHash: "$2a$10$hashedpassword",
  name: "Test User",
  isActive: true,
  role: {
    id: "role-123",
    name: "Admin",
    permissions: '["submit:invoice","read:documents"]',
  },
  companies: [
    {
      company: {
        id: "company-123",
        name: "Test Company",
        tin: "C12345678901",
      },
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockInactiveUser = {
  ...mockUser,
  id: "user-inactive",
  email: "inactive@example.com",
  isActive: false,
};

// Use a fixed token that our mock will recognize
const VALID_TEST_TOKEN = "valid-test-token";

describe("TST-01: Authentication API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/v1/auth/login", () => {
    it("should return tokens for valid credentials", async () => {
      vi.mocked(storage.findUserByEmailWithCompanies).mockResolvedValue(mockUser as any);
      vi.mocked(password.verifyPassword).mockResolvedValue(true);
      vi.mocked(storage.createRefreshToken).mockResolvedValue({} as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "test@example.com",
          password: "validPassword123",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.expiresAt).toBeDefined();
      expect(body.user.id).toBe("user-123");
      expect(body.user.email).toBe("test@example.com");
    });

    it("should return 401 for invalid email", async () => {
      vi.mocked(storage.findUserByEmailWithCompanies).mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "nonexistent@example.com",
          password: "anyPassword",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.message).toContain("Invalid email or password");
    });

    it("should return 401 for invalid password", async () => {
      vi.mocked(storage.findUserByEmailWithCompanies).mockResolvedValue(mockUser as any);
      vi.mocked(password.verifyPassword).mockResolvedValue(false);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "test2@example.com",
          password: "wrongPassword",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.message).toContain("Invalid email or password");
    });

    it("should return 401 for inactive user", async () => {
      vi.mocked(storage.findUserByEmailWithCompanies).mockResolvedValue(mockInactiveUser as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "inactive@example.com",
          password: "validPassword123",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.message).toContain("Account is disabled");
    });

    it("should return 401 for company access denied", async () => {
      vi.mocked(storage.findUserByEmailWithCompanies).mockResolvedValue(mockUser as any);
      vi.mocked(password.verifyPassword).mockResolvedValue(true);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "test3@example.com",
          password: "validPassword123",
          companyId: "company-not-accessible",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.message).toContain("Access denied");
    });

    it("should return 400 for missing email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          password: "somePassword",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 400 for missing password", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "test@example.com",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 400 for invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "not-an-email",
          password: "somePassword",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /api/v1/auth/logout", () => {
    it("should logout successfully with valid token", async () => {
      vi.mocked(storage.findUserByIdWithCompanies).mockResolvedValue(mockUser as any);
      vi.mocked(storage.revokeRefreshToken).mockResolvedValue({} as any);

      const accessToken = VALID_TEST_TOKEN;

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          refreshToken: "mock-refresh-token",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toContain("Logged out");
    });

    it("should return 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        payload: {
          refreshToken: "some-refresh-token",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /api/v1/auth/refresh", () => {
    it("should return 401 for invalid refresh token format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: {
          refreshToken: "invalid-refresh-token",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 400 for missing refresh token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/v1/auth/me", () => {
    it("should return current user details", async () => {
      vi.mocked(storage.findUserByIdWithCompanies).mockResolvedValue(mockUser as any);

      const accessToken = VALID_TEST_TOKEN;

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe("user-123");
      expect(body.email).toBe("test@example.com");
      expect(body.name).toBe("Test User");
    });

    it("should return 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 401 with invalid auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: {
          authorization: "Bearer invalid-token",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 401 with expired token", async () => {
      // Use a token that our mock will reject (not "valid-test-token")
      const expiredToken = "expired-test-token";

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
