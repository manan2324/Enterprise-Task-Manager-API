import { z } from 'zod';

export const createBoardSchema = z
  .object({
    name: z.string().min(1, 'Board name is required').max(100).trim(),
  })
  .strict();

export const updateBoardSchema = z
  .object({
    name: z.string().min(1, 'Board name is required').max(100).trim(),
  })
  .strict();

export const createColumnSchema = z
  .object({
    name: z.string().min(1, 'Column name is required').max(50).trim(),
    position: z.number().positive().optional(),
  })
  .strict();

export const updateColumnSchema = z
  .object({
    name: z.string().min(1).max(50).trim().optional(),
    position: z.number().positive().optional(),
  })
  .strict();

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;

