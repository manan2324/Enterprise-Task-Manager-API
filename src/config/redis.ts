import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

function createRedisClient(name: string, overrides: Record<string, unknown> = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    ...overrides,
  });

  client.on('connect', () => {
    logger.info({ name }, `Redis [${name}] connected`);
  });

  client.on('error', (err: Error) => {
    logger.error({ name, err }, `Redis [${name}] connection error`);
  });

  client.on('close', () => {
    logger.info({ name }, `Redis [${name}] connection closed`);
  });

  return client;
}

/** Dedicated connection for cache-aside reads/writes, locks, and rate limiting */
export const cacheRedis = createRedisClient('cache');

/** Dedicated connection for BullMQ queues */
export const queueRedis = createRedisClient('queue', { maxRetriesPerRequest: null });

/** Dedicated connection for BullMQ workers / repeaters */
export const workerRedis = createRedisClient('worker', { maxRetriesPerRequest: null });

/** Aliased default connection for backward compatibility with existing rate limiters */
export const redis = cacheRedis;
