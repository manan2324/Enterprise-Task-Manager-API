import type { Request, Response, NextFunction } from 'express';
import { type ZodObject, type ZodType, ZodError } from 'zod';

interface ValidationSchemas {
  body?: ZodType;
  params?: ZodObject;
  query?: ZodObject;
}

/**
 * Validates req.body, req.params, and/or req.query against Zod schemas.
 * Replaces the values with parsed (and typed) results on success.
 * Throws ZodError on failure → caught by errorHandler → 400.
 */
export const validate = (schemas: ValidationSchemas) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const errors: ZodError[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data;
      } else {
        errors.push(result.error);
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        Object.defineProperty(req, 'params', {
          value: result.data,
          writable: true,
          configurable: true,
        });
      } else {
        errors.push(result.error);
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
        });
      } else {
        errors.push(result.error);
      }
    }

    if (errors.length > 0) {
      const combined = new ZodError(errors.flatMap((e) => e.issues));
      next(combined);
      return;
    }

    next();
  };
};
