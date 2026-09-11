/**
 * The Prisma client, one instance for the process.
 *
 * `tsx watch` reloads the module graph on every save, so the client is stashed
 * on `globalThis` in development to stop each reload opening a fresh pool
 * against Neon and exhausting the connection limit.
 */

import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ["error"] : ["warn", "error"],
  });

if (!env.isProduction) globalForPrisma.prisma = prisma;

export interface DbPing {
  up: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Used by `GET /health`. The latency is reported rather than swallowed: a cold
 * Neon compute answers in several seconds on the first request after an idle
 * spell, and that reads very differently from a broken deploy.
 */
export async function pingDb(): Promise<DbPing> {
  const startedAt = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { up: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      up: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
