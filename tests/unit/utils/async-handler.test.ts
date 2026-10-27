import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../../src/utils/async-handler.js';

describe('asyncHandler', () => {
  it('calls wrapped function with req, res, and next', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const handler = asyncHandler(fn);

    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    handler(req, res, next);
    await Promise.resolve();

    expect(fn).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('catches asynchronous rejection and passes error to next', async () => {
    const error = new Error('Async boom');
    const fn = vi.fn().mockRejectedValue(error);
    const handler = asyncHandler(fn);

    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    handler(req, res, next);
    await new Promise((r) => setTimeout(r, 10));

    expect(next).toHaveBeenCalledWith(error);
  });
});
