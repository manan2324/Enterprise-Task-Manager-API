import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { sendSuccess } from '../../../src/utils/response.js';

describe('sendSuccess', () => {
  it('sends response with { data } when meta is omitted', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;

    sendSuccess(res, 200, { id: '123', name: 'Task' });

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ data: { id: '123', name: 'Task' } });
  });

  it('sends response with { data, meta } when meta is provided', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;

    const data = [{ id: '1' }, { id: '2' }];
    const meta = { total: 2, page: 1, limit: 10 };

    sendSuccess(res, 201, data, meta);

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({ data, meta });
  });
});
