import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/app-error.js';
import { verifyAccessToken } from '../utils/token.js';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Token not provided');
  }

  const payload = verifyAccessToken(token);
  req.user = {
    id: payload.sub,
    email: payload.email,
  };

  next();
}

