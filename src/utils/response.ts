import type { Response } from 'express';

export interface ApiResponse<T, M = unknown> {
  data: T;
  meta?: M;
}

/**
 * Standard API success response envelope: { data, meta? }
 */
export function sendSuccess<T, M = unknown>(
  res: Response,
  statusCode: number,
  data: T,
  meta?: M,
): void {
  const body: ApiResponse<T, M> = { data };
  if (meta !== undefined) {
    body.meta = meta;
  }
  res.status(statusCode).json(body);
}
