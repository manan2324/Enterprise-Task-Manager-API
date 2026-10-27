import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

/**
 * Assigns a unique request ID (UUID v4) to each request.
 * Accepts an inbound X-Request-Id header if present, otherwise generates one.
 * Echoes the ID back in the response header.
 */
export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
