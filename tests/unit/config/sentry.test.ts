import { describe, it, expect } from 'vitest';
import { initSentry, captureException, closeSentry } from '../../../src/config/sentry.js';

describe('Sentry Error Tracking Integration', () => {
  it('handles safe operations when SENTRY_DSN is not configured', async () => {
    expect(() => initSentry()).not.toThrow();
    expect(() => captureException(new Error('Sample error'), { context: 'test' })).not.toThrow();
    const closed = await closeSentry(100);
    expect(closed).toBe(true);
  });
});
