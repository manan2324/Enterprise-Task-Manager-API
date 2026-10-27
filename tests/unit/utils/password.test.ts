import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/utils/password.js';

describe('password utility', () => {
  it('hashes plain text into argon2id format', async () => {
    const plain = 'StrongP@ssw0rd!';
    const hash = await hashPassword(plain);

    expect(hash).toBeDefined();
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies correct password returns true', async () => {
    const plain = 'SecretKey123$';
    const hash = await hashPassword(plain);

    const match = await verifyPassword(hash, plain);
    expect(match).toBe(true);
  });

  it('verifies incorrect password returns false', async () => {
    const plain = 'SecretKey123$';
    const hash = await hashPassword(plain);

    const match = await verifyPassword(hash, 'WrongPassword');
    expect(match).toBe(false);
  });

  it('returns false gracefully when hash is corrupted', async () => {
    const match = await verifyPassword('not-a-valid-argon2-hash', 'Password');
    expect(match).toBe(false);
  });
});

