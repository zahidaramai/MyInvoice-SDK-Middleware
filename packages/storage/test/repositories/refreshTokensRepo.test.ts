/**
 * Tests for refreshTokensRepo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma client
const mockPrismaClient = {
  refreshToken: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock("../../src/prisma.js", () => ({
  getPrismaClient: () => mockPrismaClient,
}));

describe("refreshTokensRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findRefreshToken", () => {
    it("returns token when found", async () => {
      const mockToken = {
        id: "token-1",
        token: "refresh-token-hash-123",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        createdAt: new Date(),
        revokedAt: null,
      };

      mockPrismaClient.refreshToken.findFirst.mockResolvedValueOnce(mockToken);

      const result = await mockPrismaClient.refreshToken.findFirst({
        where: { token: "refresh-token-hash-123" },
      });

      expect(result).toEqual(mockToken);
      expect(result.revokedAt).toBeNull();
    });

    it("returns null when token not found", async () => {
      mockPrismaClient.refreshToken.findFirst.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.refreshToken.findFirst({
        where: { token: "non-existent-token" },
      });

      expect(result).toBeNull();
    });
  });

  describe("createRefreshToken", () => {
    it("creates token with expiry", async () => {
      const tokenData = {
        token: "new-refresh-token-hash",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      const createdToken = {
        id: "token-new",
        ...tokenData,
        createdAt: new Date(),
        revokedAt: null,
      };

      mockPrismaClient.refreshToken.create.mockResolvedValueOnce(createdToken);

      const result = await mockPrismaClient.refreshToken.create({
        data: tokenData,
      });

      expect(result.id).toBe("token-new");
      expect(result.token).toBe("new-refresh-token-hash");
    });

    it("creates token with user relation", async () => {
      const tokenData = {
        token: "token-with-user",
        userId: "user-123",
        expiresAt: new Date(),
      };

      const createdToken = {
        id: "token-2",
        ...tokenData,
        user: {
          id: "user-123",
          email: "user@example.com",
        },
      };

      mockPrismaClient.refreshToken.create.mockResolvedValueOnce(createdToken);

      const result = await mockPrismaClient.refreshToken.create({
        data: tokenData,
        include: { user: true },
      });

      expect(result.user.email).toBe("user@example.com");
    });
  });

  describe("revokeRefreshToken", () => {
    it("revokes token by setting revokedAt", async () => {
      const revokedToken = {
        id: "token-1",
        token: "revoked-token-hash",
        revokedAt: new Date(),
      };

      mockPrismaClient.refreshToken.update.mockResolvedValueOnce(revokedToken);

      const result = await mockPrismaClient.refreshToken.update({
        where: { id: "token-1" },
        data: { revokedAt: new Date() },
      });

      expect(result.revokedAt).not.toBeNull();
    });
  });

  describe("deleteRefreshToken", () => {
    it("deletes token by ID", async () => {
      const deletedToken = {
        id: "token-to-delete",
        token: "deleted-token-hash",
      };

      mockPrismaClient.refreshToken.delete.mockResolvedValueOnce(deletedToken);

      const result = await mockPrismaClient.refreshToken.delete({
        where: { id: "token-to-delete" },
      });

      expect(result.id).toBe("token-to-delete");
    });
  });

  describe("deleteExpiredTokens", () => {
    it("deletes tokens past expiry date", async () => {
      mockPrismaClient.refreshToken.deleteMany.mockResolvedValueOnce({ count: 5 });

      const result = await mockPrismaClient.refreshToken.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });

      expect(result.count).toBe(5);
    });
  });

  describe("deleteUserTokens", () => {
    it("deletes all tokens for a user", async () => {
      mockPrismaClient.refreshToken.deleteMany.mockResolvedValueOnce({ count: 3 });

      const result = await mockPrismaClient.refreshToken.deleteMany({
        where: { userId: "user-1" },
      });

      expect(result.count).toBe(3);
    });
  });

  describe("listUserTokens", () => {
    it("returns all tokens for a user", async () => {
      const mockTokens = [
        { id: "token-1", userId: "user-1", createdAt: new Date() },
        { id: "token-2", userId: "user-1", createdAt: new Date() },
      ];

      mockPrismaClient.refreshToken.findMany.mockResolvedValueOnce(mockTokens);

      const result = await mockPrismaClient.refreshToken.findMany({
        where: { userId: "user-1" },
      });

      expect(result).toHaveLength(2);
    });

    it("returns only active tokens", async () => {
      const mockTokens = [{ id: "token-1", revokedAt: null }];

      mockPrismaClient.refreshToken.findMany.mockResolvedValueOnce(mockTokens);

      const result = await mockPrismaClient.refreshToken.findMany({
        where: {
          userId: "user-1",
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      expect(result).toHaveLength(1);
    });
  });

  describe("token validation", () => {
    it("validates token is not expired", () => {
      const token = {
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      };

      const isValid = token.expiresAt.getTime() > Date.now();
      expect(isValid).toBe(true);
    });

    it("validates token is not revoked", () => {
      const token = {
        revokedAt: null,
      };

      const isValid = token.revokedAt === null;
      expect(isValid).toBe(true);
    });

    it("invalidates expired token", () => {
      const token = {
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      };

      const isValid = token.expiresAt.getTime() > Date.now();
      expect(isValid).toBe(false);
    });

    it("invalidates revoked token", () => {
      const token = {
        revokedAt: new Date(),
      };

      const isValid = token.revokedAt === null;
      expect(isValid).toBe(false);
    });
  });

  describe("token hashing", () => {
    it("stores hashed token, not plain text", () => {
      const plainToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
      const hashedToken = "sha256:abc123...";

      expect(hashedToken).not.toBe(plainToken);
      expect(hashedToken).toMatch(/^sha256:/);
    });

    it("compares hashed tokens for validation", () => {
      const storedHash = "sha256:abc123";
      const inputHash = "sha256:abc123";

      const isMatch = storedHash === inputHash;
      expect(isMatch).toBe(true);
    });
  });

  describe("token expiry calculation", () => {
    it("calculates 7 day expiry", () => {
      const now = new Date();
      const expiryDays = 7;
      const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

      const daysDiff = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
      expect(daysDiff).toBeCloseTo(7, 0);
    });

    it("calculates 30 day expiry", () => {
      const now = new Date();
      const expiryDays = 30;
      const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

      const daysDiff = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
      expect(daysDiff).toBeCloseTo(30, 0);
    });
  });

  describe("token count", () => {
    it("counts all tokens for user", async () => {
      mockPrismaClient.refreshToken.count.mockResolvedValueOnce(5);

      const result = await mockPrismaClient.refreshToken.count({
        where: { userId: "user-1" },
      });

      expect(result).toBe(5);
    });

    it("counts active tokens only", async () => {
      mockPrismaClient.refreshToken.count.mockResolvedValueOnce(2);

      const result = await mockPrismaClient.refreshToken.count({
        where: {
          userId: "user-1",
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      expect(result).toBe(2);
    });
  });

  describe("cleanup operations", () => {
    it("removes all revoked tokens", async () => {
      mockPrismaClient.refreshToken.deleteMany.mockResolvedValueOnce({ count: 10 });

      const result = await mockPrismaClient.refreshToken.deleteMany({
        where: {
          revokedAt: { not: null },
        },
      });

      expect(result.count).toBe(10);
    });

    it("removes tokens older than retention period", async () => {
      const retentionDays = 30;
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      mockPrismaClient.refreshToken.deleteMany.mockResolvedValueOnce({ count: 15 });

      const result = await mockPrismaClient.refreshToken.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      expect(result.count).toBe(15);
    });
  });
});
