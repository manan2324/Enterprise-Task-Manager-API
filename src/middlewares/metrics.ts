import type { Request, Response, NextFunction } from 'express';
import { httpRequestDurationSeconds, httpRequestsTotal } from '../config/metrics.js';

/**
 * Middleware measuring HTTP RED metrics (Rate, Errors, Duration) for every request.
 */
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (req.path === '/metrics') {
    next();
    return;
  }

  const endTimer = httpRequestDurationSeconds.startTimer();

  res.on('finish', () => {
    // Group parameterized paths or base routes for low cardinality metrics
    const route = req.baseUrl || req.route?.path || req.path || 'unknown';
    const labels = {
      method: req.method,
      route: String(route),
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    endTimer(labels);
  });

  next();
};
