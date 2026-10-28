import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/app-error.js';

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

/**
 * Section 14.3: Load shedding pattern.
 * If event loop delay exceeds 200ms, sheds non-essential traffic with 503 + Retry-After.
 */
export const loadShedding = (req: Request, res: Response, next: NextFunction): void => {
  // Exclude health, readiness, metrics, and API documentation endpoints
  if (
    req.path === '/health' ||
    req.path === '/ready' ||
    req.path === '/metrics' ||
    req.path.startsWith('/docs') ||
    req.path === '/openapi.json'
  ) {
    next();
    return;
  }

  // Calculate mean delay in milliseconds
  const delayMs = histogram.mean / 1_000_000;
  if (delayMs > 200) {
    res.setHeader('Retry-After', '5');
    throw new AppError(503, 'SERVER_BUSY', 'Server is under heavy load, please retry shortly');
  }

  next();
};
