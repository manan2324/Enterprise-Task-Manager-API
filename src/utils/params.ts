import type { Request } from 'express';

export function getParam(req: Request, key: string): string {
  const val = req.params[key];
  if (!val) return '';
  return Array.isArray(val) ? (val[0] ?? '') : val;
}

