/**
 * Refresh tokens repository - handles persistence of JWT refresh tokens
 */

import { getPrismaClient } from "../prisma.js";
import type { CreateRefreshTokenInput } from "../types.js";
import type { RefreshToken } from "@prisma/client";

/**
 * Create a new refresh token
 */
export async function createRefreshToken(
  input: CreateRefreshTokenInput
): Promise<RefreshToken> {
  const prisma = getPrismaClient();

  return prisma.refreshToken.create({
    data: {
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    },
  });
}

/**
 * Find refresh token by hash
 */
export async function findRefreshTokenByHash(
  tokenHash: string
): Promise<RefreshToken | null> {
  const prisma = getPrismaClient();

  return prisma.refreshToken.findUnique({
    where: { tokenHash },
  });
}

/**
 * Find valid (non-revoked, non-expired) refresh token by hash
 */
export async function findValidRefreshToken(
  tokenHash: string
): Promise<RefreshToken | null> {
  const prisma = getPrismaClient();

  return prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      revoked: false,
      expiresAt: { gt: new Date() },
    },
  });
}

/**
 * Revoke refresh token by hash
 */
export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.refreshToken.update({
    where: { tokenHash },
    data: {
      revoked: true,
      revokedAt: new Date(),
    },
  });
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const prisma = getPrismaClient();

  const result = await prisma.refreshToken.updateMany({
    where: {
      userId,
      revoked: false,
    },
    data: {
      revoked: true,
      revokedAt: new Date(),
    },
  });

  return result.count;
}

/**
 * Delete expired tokens (cleanup job)
 */
export async function deleteExpiredTokens(): Promise<number> {
  const prisma = getPrismaClient();

  const result = await prisma.refreshToken.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  return result.count;
}

/**
 * Delete revoked tokens older than specified days (cleanup job)
 */
export async function deleteOldRevokedTokens(olderThanDays = 7): Promise<number> {
  const prisma = getPrismaClient();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const result = await prisma.refreshToken.deleteMany({
    where: {
      revoked: true,
      revokedAt: { lt: cutoff },
    },
  });

  return result.count;
}

/**
 * Count active tokens for a user
 */
export async function countActiveTokensForUser(userId: string): Promise<number> {
  const prisma = getPrismaClient();

  return prisma.refreshToken.count({
    where: {
      userId,
      revoked: false,
      expiresAt: { gt: new Date() },
    },
  });
}
