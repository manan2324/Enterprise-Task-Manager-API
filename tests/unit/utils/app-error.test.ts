import { describe, it, expect } from 'vitest';
import { AppError } from '../../../src/utils/app-error.js';

describe('AppError', () => {
  it('instantiates with statusCode, code, message and details', () => {
    const error = new AppError(404, 'NOT_FOUND', 'Workspace not found', { id: 'ws-123' });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Workspace not found');
    expect(error.details).toEqual({ id: 'ws-123' });
    expect(error.isOperational).toBe(true);
  });

  it('defaults message to code when message is omitted', () => {
    const error = new AppError(400, 'BAD_REQUEST');

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toBe('BAD_REQUEST');
  });
});
