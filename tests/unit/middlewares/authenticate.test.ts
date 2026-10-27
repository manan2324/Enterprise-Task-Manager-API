import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../../src/middlewares/authenticate.js';
import { signAccessToken } from '../../../src/utils/token.js';
import { AppError } from '../../../src/utils/app-error.js';

describe('authenticate middleware', () => {
  const res = {} as Response;
  const next = vi.fn() as unknown as NextFunction;

  it('throws AppError(401) when authorization header is missing', () => {
    const req = { headers: {} } as Request;
    expect(() => authenticate(req, res, next)).toThrow(AppError);
  });

  it('throws AppError(401) when authorization header is not Bearer', () => {
    const req = { headers: { authorization: 'Basic xyz' } } as Request;
    expect(() => authenticate(req, res, next)).toThrow(AppError);
  });

  it('attaches req.user and calls next() on valid token', () => {
    const token = signAccessToken({ sub: 'user-abc-123', email: 'test@example.com' });
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Request;

    authenticate(req, res, next);

    expect(req.user).toEqual({
      id: 'user-abc-123',
      email: 'test@example.com',
    });
    expect(next).toHaveBeenCalled();
  });
});
