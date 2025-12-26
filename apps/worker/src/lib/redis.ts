/**
 * Redis connection for BullMQ
 */

import { Redis } from "ioredis";

let redisConnection: Redis | null = null;

/**
 * Get Redis URL from environment
 */
function getRedisUrl(): string {
  return process.env.REDIS_URL || "redis://localhost:6379";
}

/**
 * Get or create Redis connection
 */
export function getRedisConnection(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    });
  }
  return redisConnection;
}

/**
 * Close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}

/**
 * Check if Redis is connected
 */
export async function isRedisConnected(): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
