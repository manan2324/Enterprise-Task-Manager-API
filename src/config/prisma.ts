import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';
import { logger } from './logger.js';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

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
