import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, '🚀 Server started');
});

// Ensure keep-alive timeout > load balancer idle timeout to avoid 502s
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// ── Graceful Shutdown ──
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully…');

  server.close(async () => {
    await Promise.allSettled([
      prisma.$disconnect(),
      redis.quit(),
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
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
