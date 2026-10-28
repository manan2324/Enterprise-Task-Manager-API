import { startWorkers } from './jobs/worker.js';
import { logger } from './config/logger.js';
import { initSentry, captureException, closeSentry } from './config/sentry.js';
import { prisma, dbPool } from './config/prisma.js';
import { cacheRedis, queueRedis, workerRedis } from './config/redis.js';

// Initialize Sentry first
initSentry();

const runner = startWorkers();
logger.info('🚀 Background worker and outbox relay process started');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down worker process gracefully…');

  await runner.stop();
  await Promise.allSettled([
    prisma.$disconnect(),
    dbPool.end(),
    cacheRedis.quit(),
    queueRedis.quit(),
    workerRedis.quit(),
    closeSentry(2000),
  ]);
  logger.info('Worker cleanup complete, exiting');
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Worker unhandled rejection');
  captureException(reason);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Worker uncaught exception — exiting');
  captureException(err);
  process.exit(1);
});
