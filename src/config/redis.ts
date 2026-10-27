import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: true,
  lazyConnect: true,
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('close', () => {
  logger.info('Redis connection closed');
});
