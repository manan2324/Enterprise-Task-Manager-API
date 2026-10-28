import { describe, it, expect } from 'vitest';
import { between } from '../../../src/utils/position.js';

describe('position between utility', () => {
  it('returns 1000 when neither before nor after is provided', () => {
    expect(between()).toBe(1000);
    expect(between(undefined, undefined)).toBe(1000);
  });

  it('returns after / 2 when inserting at the head (before is undefined)', () => {
    expect(between(undefined, 1000)).toBe(500);
    expect(between(undefined, 500)).toBe(250);
  });

  it('returns before + 1000 when inserting at the tail (after is undefined)', () => {
    expect(between(1000, undefined)).toBe(2000);
    expect(between(3000, undefined)).toBe(4000);
  });

  it('returns midpoint when inserting between two items', () => {
    expect(between(1000, 2000)).toBe(1500);
    expect(between(1000, 1500)).toBe(1250);
    expect(between(1500, 2000)).toBe(1750);
  });
});
