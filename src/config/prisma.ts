import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';
import { logger } from './logger.js';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/**
 * Shared PostgreSQL connection pool configured according to BUILD_GUIDE §13.3:
 * - Pool limit: 10 connections per replica
 * - Safety timeouts: statement_timeout=5s, lock_timeout=2s, idle_in_transaction_session_timeout=10s
 */
export const dbPool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

dbPool.on('connect', (client) => {
  client.query(
    'SET statement_timeout = 5000; SET lock_timeout = 2000; SET idle_in_transaction_session_timeout = 10000;',
    (err) => {
      if (err) {
        logger.warn({ err }, 'Failed to set PostgreSQL session timeouts');
      }
    },
  );
});

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg(dbPool);

  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV === 'development') {
  prisma.$on('query' as never, (e: unknown) => {
    const event = e as { query: string; duration: number };
    logger.debug({ query: event.query, duration: event.duration }, 'prisma query');
  });
}

prisma.$on('error' as never, (e: unknown) => {
  const event = e as { message: string };
  logger.error({ err: event.message }, 'prisma error');
});

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
