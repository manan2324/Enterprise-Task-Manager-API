import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { loadShedding } from '../../../src/middlewares/load-shedding.js';

describe('Load Shedding Middleware (§14.3)', () => {
  it('allows health, metrics, and doc endpoints to pass unconditionally', () => {
    const paths = ['/health', '/ready', '/metrics', '/docs', '/docs/index.html', '/openapi.json'];

    for (const path of paths) {
      const req = { path } as Request;
      const res = { setHeader: vi.fn() } as unknown as Response;
      const next = vi.fn() as NextFunction;

      loadShedding(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('allows normal traffic through when event loop delay is normal', () => {
    const req = { path: '/tasks/123' } as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    loadShedding(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
