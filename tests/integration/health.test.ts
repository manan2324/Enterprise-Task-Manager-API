import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';

describe('Health & System Endpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /health returns 200 with status ok and timestamp', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('generates X-Request-Id header when not supplied', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toBeDefined();
    expect(typeof res.headers['x-request-id']).toBe('string');
  });

  it('echoes client-provided X-Request-Id header', async () => {
    const customId = 'test-req-id-12345';
    const res = await request(app).get('/health').set('X-Request-Id', customId);

    expect(res.headers['x-request-id']).toBe(customId);
  });

  it('returns 404 with structured error envelope for non-existent routes', async () => {
    const res = await request(app).get('/non-existent-route');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  it('GET /ready returns 200 when database and redis are healthy', async () => {
    vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([{ '?column?': 1 }]);
    vi.spyOn(redis, 'ping').mockResolvedValue('PONG');

    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      checks: {
        database: 'ok',
        redis: 'ok',
      },
    });
    expect(res.body).toHaveProperty('timestamp');
  });

  it('GET /ready returns 503 degraded when a dependency fails', async () => {
    vi.spyOn(prisma, '$queryRawUnsafe').mockRejectedValue(new Error('DB unreachable'));
    vi.spyOn(redis, 'ping').mockResolvedValue('PONG');

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'degraded',
      checks: {
        database: 'error',
        redis: 'ok',
      },
    });
  });

  it('GET /ready verifies real live Postgres and Redis dependencies', async () => {
    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      checks: {
        database: 'ok',
        redis: 'ok',
      },
    });
  });
});
