import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { errorHandler } from '../../../src/middlewares/error-handler.js';
import { AppError } from '../../../src/utils/app-error.js';
import { Prisma } from '../../../src/generated/prisma/client.js';

describe('errorHandler middleware', () => {
  const createMockRes = () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return { status, json } as unknown as Response & {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
    };
  };

  const createMockReq = (id?: string) =>
    ({
      id,
    }) as unknown as Request;

  const next = vi.fn() as unknown as NextFunction;

  it('handles ZodError and responds with 400 and validation details', () => {
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);

    if (!result.success) {
      const res = createMockRes();
      const req = createMockReq('req-zod-123');

      errorHandler(result.error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: { email: expect.any(Array) },
          requestId: 'req-zod-123',
        },
      });
    }
  });

  it('handles AppError and responds with custom statusCode and envelope', () => {
    const res = createMockRes();
    const req = createMockReq('req-app-123');
    const err = new AppError(403, 'FORBIDDEN', 'Insufficient permissions', { requiredRole: 'ADMIN' });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
        details: { requiredRole: 'ADMIN' },
        requestId: 'req-app-123',
      },
    });
  });

  it('handles Prisma P2002 unique constraint conflict as 409', () => {
    const res = createMockRes();
    const req = createMockReq('req-prisma-2002');
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.x',
      meta: { target: ['email'] },
    });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'CONFLICT',
        message: 'A record with that value already exists',
        details: { fields: ['email'] },
        requestId: 'req-prisma-2002',
      },
    });
  });

  it('handles Prisma P2025 record not found as 404', () => {
    const res = createMockRes();
    const req = createMockReq('req-prisma-2025');
    const err = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '7.x',
    });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        requestId: 'req-prisma-2025',
      },
    });
  });

  it('handles unhandled generic errors and responds with 500', () => {
    const res = createMockRes();
    const req = createMockReq('req-500');
    const err = new Error('Unexpected crash');

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        requestId: 'req-500',
      },
    });
  });
});
