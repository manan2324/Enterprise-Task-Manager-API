import rateLimit, { type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';

function createStore(prefix: string) {
  if (env.NODE_ENV === 'test') {
    return undefined; // In tests, use memory store for fast isolated runs
  }
  return new RedisStore({
    sendCommand: (...args: string[]) => redis.call(args[0] ?? '', ...args.slice(1)) as Promise<never>,
    prefix: `rl:${prefix}:`,
  });
}

const standardHandler: Options['handler'] = (_req, res) => {
  res.status(429).json({
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests, please try again later.',
    },
  });
};

/**
 * Limit signup attempts to 10 per hour per IP
 */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: env.NODE_ENV === 'test' ? 100 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('signup'),
  handler: standardHandler,
});

/**
 * Limit login attempts to 5 per minute per IP + email
 */
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: env.NODE_ENV === 'test' ? 100 : 5,
  keyGenerator: (req) => `${req.ip}_${(req.body as { email?: string })?.email ?? ''}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('login'),
  handler: standardHandler,
});

/**
 * Limit forgot password attempts to 3 per hour per email
 */
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: env.NODE_ENV === 'test' ? 100 : 3,
  keyGenerator: (req) => `${(req.body as { email?: string })?.email ?? req.ip}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('forgot-password'),
  handler: standardHandler,
});
