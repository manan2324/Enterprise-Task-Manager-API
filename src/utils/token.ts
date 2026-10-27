import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './app-error.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

/**
 * Computes a deterministic SHA-256 hex hash of a raw token.
 * Raw tokens (refresh tokens, invite tokens, reset tokens) are NEVER stored in plaintext.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generates a cryptographically secure random token (default 256-bit = 32 bytes hex).
 */
export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Signs a short-lived access JWT containing only sub (userId) and email.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Verifies an access JWT and returns its typed payload.
 * Throws AppError(401, 'INVALID_TOKEN') on invalid or expired token.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof decoded !== 'object' || decoded === null || !('sub' in decoded) || !('email' in decoded)) {
      throw new AppError(401, 'INVALID_TOKEN', 'Token payload is malformed');
    }
    return {
      sub: String((decoded as AccessTokenPayload).sub),
      email: String((decoded as AccessTokenPayload).email),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired');
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Access token verification failed');
  }
}
