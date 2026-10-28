import * as Sentry from '@sentry/node';
import { env } from './env.js';
import { logger } from './logger.js';

let sentryInitialized = false;

/**
 * Initializes Sentry if SENTRY_DSN is provided in environment variables.
 * Attaches environment, sample rates, and tags.
 */
export const initSentry = (): void => {
  if (!env.SENTRY_DSN) {
    logger.debug('SENTRY_DSN not configured — Sentry error tracking disabled');
    return;
  }

  try {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
      integrations: [],
    });
    sentryInitialized = true;
    logger.info({ env: env.NODE_ENV }, 'Sentry error tracking initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Sentry');
  }
};

/**
 * Captures an unhandled exception or 5xx server error into Sentry with extra context.
 */
export const captureException = (err: unknown, context?: Record<string, unknown>): void => {
  if (!sentryInitialized) return;
  try {
    Sentry.captureException(err, {
      extra: context,
    });
  } catch {
    // Fail silently if Sentry capture fails
  }
};

/**
 * Flushes pending Sentry events before shutdown.
 */
export const closeSentry = async (timeoutMs = 2000): Promise<boolean> => {
  if (!sentryInitialized) return true;
  try {
    await Sentry.close(timeoutMs);
    return true;
  } catch {
    return false;
  }
};
