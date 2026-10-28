import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { idempotencyReplaysTotal } from '../config/metrics.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Implements Section 14.1 Idempotency Keys pattern.
 * Guards non-idempotent operations against network retries or double-submissions.
 */
export const idempotency = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) {
    next();
    return;
  }

  const userId = req.user?.id ?? 'anonymous';
  const requestHash = createHash('sha256')
    .update(JSON.stringify(req.body ?? {}))
    .digest('hex');

  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      userId_key: {
        userId,
        key: idempotencyKey,
      },
    },
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was previously used with a different request payload',
      );
    }

    if (existing.responseCode !== null) {
      idempotencyReplaysTotal.inc();
      res.status(existing.responseCode).json(existing.responseBody);
      return;
    }

    throw new AppError(
      409,
      'REQUEST_IN_PROGRESS',
      'A request with this idempotency key is currently in progress',
    );
  }

  // Reserve the key
  try {
    await prisma.idempotencyKey.create({
      data: {
        userId,
        key: idempotencyKey,
        requestHash,
      },
    });
  } catch (err: unknown) {
    // Handle race condition on duplicate insert
    const race = await prisma.idempotencyKey.findUnique({
      where: { userId_key: { userId, key: idempotencyKey } },
    });
    if (race) {
      if (race.requestHash !== requestHash) {
        throw new AppError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was previously used with a different request payload',
        );
      }
      if (race.responseCode !== null) {
        idempotencyReplaysTotal.inc();
        res.status(race.responseCode).json(race.responseBody);
        return;
      }
      throw new AppError(
        409,
        'REQUEST_IN_PROGRESS',
        'A request with this idempotency key is currently in progress',
      );
    }
    throw err;
  }

  // Capture response status and body on completion
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown): Response {
    const statusCode = res.statusCode;

    // Asynchronously save completed response in background
    void prisma.idempotencyKey
      .update({
        where: { userId_key: { userId, key: idempotencyKey } },
        data: {
          responseCode: statusCode,
          responseBody: (body ?? {}) as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});

    return originalJson(body);
  };

  next();
});
