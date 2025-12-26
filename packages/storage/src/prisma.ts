/**
 * Prisma client singleton for database access
 */

import { PrismaClient } from "@prisma/client";

// Create singleton instance
let prismaInstance: PrismaClient | null = null;

/**
 * Get the Prisma client instance
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

/**
 * Disconnect from database (for cleanup)
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

/**
 * Reset client (for testing)
 */
export function resetPrismaClient(): void {
  prismaInstance = null;
}

// Re-export Prisma types
export type { PrismaClient } from "@prisma/client";
