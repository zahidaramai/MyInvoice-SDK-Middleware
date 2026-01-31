/**
 * TIN validation cache repository - handles privacy-safe caching of TIN validation results
 *
 * PRIVACY RULES:
 * - Never store raw idValue (NRIC/passport/etc.)
 * - Only store SHA256 hash of (idValue + SALT)
 * - Taxpayer name may be stored (returned by MyInvois, not considered private)
 */

import { getPrismaClient } from "../prisma.js";
import type { GetTinCacheInput, SetTinCacheInput, TinValidateCacheRecord } from "../types.js";

/**
 * Get TIN validation result from cache
 *
 * Returns null if:
 * - No cache entry exists
 * - Cache entry has expired
 */
export async function getTinValidateCache(
  input: GetTinCacheInput
): Promise<TinValidateCacheRecord | null> {
  const prisma = getPrismaClient();
  const now = new Date();

  const cached = await prisma.tinValidateCache.findFirst({
    where: {
      env: input.env,
      sessionId: input.sessionId,
      tin: input.tin,
      idType: input.idType,
      idValueHash: input.idValueHash,
      expiresAt: {
        gt: now,
      },
    },
  });

  return cached as TinValidateCacheRecord | null;
}

/**
 * Set TIN validation result in cache
 *
 * Uses upsert to handle both insert and update cases.
 */
export async function setTinValidateCache(
  input: SetTinCacheInput
): Promise<TinValidateCacheRecord> {
  const prisma = getPrismaClient();

  const cached = await prisma.tinValidateCache.upsert({
    where: {
      env_sessionId_tin_idType_idValueHash: {
        env: input.env,
        sessionId: input.sessionId,
        tin: input.tin,
        idType: input.idType,
        idValueHash: input.idValueHash,
      },
    },
    update: {
      result: input.result,
      taxpayerName: input.taxpayerName ?? null,
      expiresAt: input.expiresAt,
      correlationId: input.correlationId ?? null,
      validatedAt: new Date(),
    },
    create: {
      env: input.env,
      sessionId: input.sessionId,
      tin: input.tin,
      idType: input.idType,
      idValueHash: input.idValueHash,
      result: input.result,
      taxpayerName: input.taxpayerName ?? null,
      expiresAt: input.expiresAt,
      correlationId: input.correlationId ?? null,
    },
  });

  return cached as TinValidateCacheRecord;
}

/**
 * Delete expired TIN cache entries
 *
 * Returns the number of deleted entries.
 */
export async function cleanupExpiredTinCache(): Promise<number> {
  const prisma = getPrismaClient();
  const now = new Date();

  const result = await prisma.tinValidateCache.deleteMany({
    where: {
      expiresAt: {
        lt: now,
      },
    },
  });

  return result.count;
}

/**
 * Delete all TIN cache entries for a session
 */
export async function deleteTinCacheForSession(sessionId: string): Promise<number> {
  const prisma = getPrismaClient();

  const result = await prisma.tinValidateCache.deleteMany({
    where: {
      sessionId,
    },
  });

  return result.count;
}
