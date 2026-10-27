import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../config/logger.js';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Central error handler: maps known error types to appropriate HTTP responses.
 * Unknown errors become 500s and are logged for investigation.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.id as string | undefined;

  // Zod validation errors → 400
  if (err instanceof ZodError) {
    const response: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten().fieldErrors,
        requestId,
      },
    };
    res.status(400).json(response);
    return;
  }

  // Known application errors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, 'Server error');
    }

    const response: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // Prisma known request error (e.g. unique constraint → 409)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const response: ErrorResponse = {
        error: {
          code: 'CONFLICT',
          message: 'A record with that value already exists',
          details: { fields: err.meta?.['target'] },
          requestId,
        },
      };
      res.status(409).json(response);
      return;
    }

    if (err.code === 'P2025') {
      const response: ErrorResponse = {
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
          requestId,
        },
      };
      res.status(404).json(response);
      return;
    }
  }

  // Unknown / unexpected errors → 500
  logger.error({ err, requestId }, 'Unhandled error');

  const response: ErrorResponse = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    },
  };
  res.status(500).json(response);
};
