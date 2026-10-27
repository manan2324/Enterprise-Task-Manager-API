import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { validate } from '../../../src/middlewares/validate.js';

describe('validate middleware', () => {
  it('calls next() when body, params, and query match schemas', () => {
    const schemas = {
      body: z.object({ title: z.string().min(3) }),
      params: z.object({ id: z.string() }),
      query: z.object({ sort: z.enum(['asc', 'desc']).optional() }),
    };

    const middleware = validate(schemas);
    const req = {
      body: { title: 'New Task' },
      params: { id: 'task-1' },
      query: { sort: 'asc' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ title: 'New Task' });
    expect(req.params).toEqual({ id: 'task-1' });
    expect(req.query).toEqual({ sort: 'asc' });
  });

  it('calls next(error) with ZodError when validation fails', () => {
    const schemas = {
      body: z.object({ title: z.string().min(3) }),
    };

    const middleware = validate(schemas);
    const req = { body: { title: 'ab' } } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const calledWith = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0];
    expect(calledWith).toBeInstanceOf(ZodError);
  });
});
