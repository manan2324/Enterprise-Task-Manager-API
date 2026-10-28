import { z } from 'zod';

export const createTaskSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(255).trim(),
    description: z.string().optional(),
    status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).default('TODO'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    dueDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/))
      .optional(),
    position: z.number().positive().optional(),
    assigneeIds: z.array(z.string().uuid()).optional(),
    tagIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(255).trim().optional(),
    description: z.string().nullable().optional(),
    status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    dueDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/))
      .nullable()
      .optional(),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const moveTaskSchema = z
  .object({
    columnId: z.string().uuid('Valid columnId UUID is required'),
    beforeTaskId: z.string().uuid().optional(),
    afterTaskId: z.string().uuid().optional(),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const updateAssigneesSchema = z
  .object({
    userIds: z.array(z.string().uuid()),
  })
  .strict();

export const updateTagsSchema = z
  .object({
    tagIds: z.array(z.string().uuid()),
  })
  .strict();

export const createSubtaskSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(255).trim(),
  })
  .strict();

export const updateSubtaskSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(255).trim().optional(),
    done: z.boolean().optional(),
  })
  .strict();

export const createCommentSchema = z
  .object({
    body: z.string().min(1, 'Comment body is required').max(10000).trim(),
  })
  .strict();

export const searchTasksQuerySchema = z
  .object({
    status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    assignee: z.string().uuid().optional(),
    dueBefore: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/))
      .optional(),
    dueAfter: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/))
      .optional(),
    q: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
  })
  .strict();

export const presignAttachmentSchema = z
  .object({
    fileName: z.string().min(1, 'File name is required').max(255).trim(),
    mimeType: z.string().min(1, 'MIME type is required').max(100).trim(),
    sizeBytes: z.number().int().positive('Size must be greater than 0'),
  })
  .strict();

export const confirmAttachmentSchema = z
  .object({
    key: z.string().min(1, 'S3 key is required').max(500).trim(),
    fileName: z.string().min(1, 'File name is required').max(255).trim(),
    mimeType: z.string().min(1, 'MIME type is required').max(100).trim(),
    sizeBytes: z.number().int().positive('Size must be greater than 0'),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type UpdateAssigneesInput = z.infer<typeof updateAssigneesSchema>;
export type UpdateTagsInput = z.infer<typeof updateTagsSchema>;
export type CreateSubtaskInput = z.infer<typeof createSubtaskSchema>;
export type UpdateSubtaskInput = z.infer<typeof updateSubtaskSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type SearchTasksQuery = z.infer<typeof searchTasksQuerySchema>;
export type PresignAttachmentInput = z.infer<typeof presignAttachmentSchema>;
export type ConfirmAttachmentInput = z.infer<typeof confirmAttachmentSchema>;
