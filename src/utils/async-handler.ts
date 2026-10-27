import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler so rejected promises
 * are forwarded to Express's error-handling middleware.
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
