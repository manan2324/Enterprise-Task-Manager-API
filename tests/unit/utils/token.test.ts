import { describe, it, expect } from 'vitest';
import {
  hashToken,
  generateRandomToken,
  signAccessToken,
  verifyAccessToken,
} from '../../../src/utils/token.js';
import { AppError } from '../../../src/utils/app-error.js';

describe('token utility', () => {
  it('hashToken produces deterministic SHA-256 output', () => {
    const raw = 'sample-refresh-token';
    const hash1 = hashToken(raw);
    const hash2 = hashToken(raw);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // 256 bits = 64 hex chars
  });

  it('generateRandomToken returns unique random hex tokens', () => {
    const t1 = generateRandomToken();
    const t2 = generateRandomToken();

    expect(t1).not.toBe(t2);
    expect(t1).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it('signs and successfully verifies an access token', () => {
    const payload = { sub: 'user-uuid-123', email: 'user@example.com' };
    const token = signAccessToken(payload);

    const verified = verifyAccessToken(token);
    expect(verified.sub).toBe(payload.sub);
    expect(verified.email).toBe(payload.email);
  });

  it('throws AppError(401) on invalid JWT token', () => {
    expect(() => verifyAccessToken('tampered.or.invalid.token')).toThrow(AppError);
  });
});
