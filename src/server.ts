import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma, dbPool } from './config/prisma.js';
import { cacheRedis, queueRedis, workerRedis } from './config/redis.js';
import { initSentry, captureException, closeSentry } from './config/sentry.js';
import { initSocketIO } from './realtime/socket.js';

// Initialize Sentry first before server starts
initSentry();

const httpServer = createServer(app);
const io = initSocketIO(httpServer);

const server = httpServer.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, '🚀 Server started');
});

// Ensure keep-alive timeout > load balancer idle timeout to avoid 502s (BUILD_GUIDE §18)
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// ── Graceful Shutdown ──
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully…');

  server.close(async () => {
    await Promise.allSettled([
      io.close(),
      prisma.$disconnect(),
      dbPool.end(),
      cacheRedis.quit(),
      queueRedis.quit(),
      workerRedis.quit(),
      closeSentry(2000),
    ]);
    logger.info('Cleanup complete, exiting');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
  captureException(reason);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  captureException(err);
  process.exit(1);
});
