import { cacheRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';

export class CacheService {
  private boardKey(boardId: string): string {
    return `board:${boardId}:v1`;
  }

  async getCachedBoard<T>(boardId: string): Promise<T | null> {
    try {
      const data = await cacheRedis.get(this.boardKey(boardId));
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err) {
      logger.warn({ err, boardId }, 'Cache read failed, falling back to database');
      return null;
    }
  }

  async setCachedBoard(boardId: string, value: unknown, ttlSeconds = 60): Promise<void> {
    try {
      await cacheRedis.set(this.boardKey(boardId), JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      logger.warn({ err, boardId }, 'Cache write failed');
    }
  }

  async invalidateBoard(boardId: string): Promise<void> {
    try {
      await cacheRedis.del(this.boardKey(boardId));
      logger.debug({ boardId }, 'Invalidated board cache');
    } catch (err) {
      logger.warn({ err, boardId }, 'Cache invalidation failed');
    }
  }
}

export const cacheService = new CacheService();
