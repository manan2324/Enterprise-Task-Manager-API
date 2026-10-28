import { z } from 'zod';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createWorkspaceSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters long').max(100).trim(),
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(slugRegex, 'Slug must be lowercase alphanumeric and may contain hyphens')
      .optional(),
  })
  .strict();

export const updateWorkspaceSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters long').max(100).trim().optional(),
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(slugRegex, 'Slug must be lowercase alphanumeric and may contain hyphens')
      .optional(),
  })
  .strict();

export const inviteMemberSchema = z
  .object({
    email: z.string().email('Valid email is required').toLowerCase().trim(),
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
  })
  .strict();

export const updateMemberRoleSchema = z
  .object({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
  })
  .strict();

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(1, 'Invitation token is required').trim(),
  })
  .strict();

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
