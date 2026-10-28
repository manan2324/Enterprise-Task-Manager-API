import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../../src/utils/pagination.js';

describe('Pagination cursor utility', () => {
  it('encodes and decodes valid cursor accurately', () => {
    const originalDate = new Date('2026-10-28T10:00:00.000Z');
    const originalId = 'task-uuid-12345';

    const encoded = encodeCursor({ createdAt: originalDate, id: originalId });
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.createdAt.toISOString()).toBe(originalDate.toISOString());
    expect(decoded?.id).toBe(originalId);
  });

  it('returns null on invalid base64 or non-JSON cursor', () => {
    expect(decodeCursor('not-valid-base64-json!')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(Buffer.from('{"invalid":"object"}').toString('base64url'))).toBeNull();
  });
});
