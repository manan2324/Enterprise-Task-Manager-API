import { z } from 'zod';

export const createTagSchema = z
  .object({
    name: z.string().min(1, 'Tag name is required').max(50).trim(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a valid 6-character hex code (e.g. #FF0000)'),
  })
  .strict();

export type CreateTagInput = z.infer<typeof createTagSchema>;
