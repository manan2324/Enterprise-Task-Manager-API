import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  signupSchema,
  verifyEmailSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../modules/auth/auth.schemas.js';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  acceptInvitationSchema,
} from '../modules/workspaces/workspaces.schemas.js';
import {
  createBoardSchema,
  updateBoardSchema,
  createColumnSchema,
  updateColumnSchema,
} from '../modules/boards/boards.schemas.js';
import {
  createTaskSchema,
  updateTaskSchema,
  moveTaskSchema,
  updateAssigneesSchema,
  updateTagsSchema,
  createSubtaskSchema,
  updateSubtaskSchema,
  createCommentSchema,
  searchTasksQuerySchema,
  presignAttachmentSchema,
  confirmAttachmentSchema,
} from '../modules/tasks/tasks.schemas.js';
import { createTagSchema } from '../modules/tags/tags.schemas.js';

// Extend Zod with OpenAPI capabilities
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// Register Security Scheme
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'JWT Bearer Access Token in Authorization header: Bearer <token>',
});

// Generic schemas
const idParamSchema = z.object({ id: z.string().uuid() });
const successResponseSchema = z.object({
  data: z.any(),
});
const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
    requestId: z.string().optional(),
  }),
});

// ── Authentication ──
registry.registerPath({
  method: 'post',
  path: '/auth/signup',
  tags: ['Auth'],
  summary: 'Register a new user account',
  request: {
    body: {
      content: { 'application/json': { schema: signupSchema } },
    },
  },
  responses: {
    201: { description: 'User registered successfully', content: { 'application/json': { schema: successResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Email already registered', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/verify-email',
  tags: ['Auth'],
  summary: 'Verify email address with token',
  request: {
    body: {
      content: { 'application/json': { schema: verifyEmailSchema } },
    },
  },
  responses: {
    200: { description: 'Email verified successfully', content: { 'application/json': { schema: successResponseSchema } } },
    400: { description: 'Invalid or expired token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['Auth'],
  summary: 'Authenticate user with email and password',
  request: {
    body: {
      content: { 'application/json': { schema: loginSchema } },
    },
  },
  responses: {
    200: { description: 'Authenticated with access token and refresh cookie', content: { 'application/json': { schema: successResponseSchema } } },
    401: { description: 'Invalid credentials', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Email not verified', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/refresh',
  tags: ['Auth'],
  summary: 'Rotate refresh token and issue new access token',
  responses: {
    200: { description: 'New token pair issued', content: { 'application/json': { schema: successResponseSchema } } },
    401: { description: 'Invalid or revoked token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  summary: 'Revoke active refresh token and clear cookies',
  responses: {
    200: { description: 'Logged out successfully', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/forgot-password',
  tags: ['Auth'],
  summary: 'Request password reset email',
  request: {
    body: {
      content: { 'application/json': { schema: forgotPasswordSchema } },
    },
  },
  responses: {
    200: { description: 'Reset instructions sent if email exists', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/reset-password',
  tags: ['Auth'],
  summary: 'Reset password with reset token',
  request: {
    body: {
      content: { 'application/json': { schema: resetPasswordSchema } },
    },
  },
  responses: {
    200: { description: 'Password reset successfully', content: { 'application/json': { schema: successResponseSchema } } },
    400: { description: 'Invalid or expired reset token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

// ── Workspaces ──
registry.registerPath({
  method: 'post',
  path: '/workspaces',
  tags: ['Workspaces'],
  summary: 'Create a new workspace',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: createWorkspaceSchema } },
    },
  },
  responses: {
    201: { description: 'Workspace created', content: { 'application/json': { schema: successResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/workspaces',
  tags: ['Workspaces'],
  summary: 'List user workspaces',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'List of workspaces', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Get workspace details and members',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Workspace details', content: { 'application/json': { schema: successResponseSchema } } },
    404: { description: 'Workspace not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Update workspace (Admin/Owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: updateWorkspaceSchema } } },
  },
  responses: {
    200: { description: 'Workspace updated', content: { 'application/json': { schema: successResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Delete workspace (Owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Workspace deleted', content: { 'application/json': { schema: successResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/workspaces/{id}/invitations',
  tags: ['Workspaces'],
  summary: 'Invite a member to the workspace',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: inviteMemberSchema } } },
  },
  responses: {
    201: { description: 'Invitation sent', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/invitations/{token}/accept',
  tags: ['Workspaces'],
  summary: 'Accept workspace invitation',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ token: z.string() }),
    body: { content: { 'application/json': { schema: acceptInvitationSchema.optional() } } },
  },
  responses: {
    200: { description: 'Joined workspace', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/workspaces/{id}/members/{memberId}',
  tags: ['Workspaces'],
  summary: 'Change member role',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid(), memberId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: updateMemberRoleSchema } } },
  },
  responses: {
    200: { description: 'Member role updated', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/workspaces/{id}/members/{memberId}',
  tags: ['Workspaces'],
  summary: 'Remove member from workspace',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid(), memberId: z.string().uuid() }),
  },
  responses: {
    200: { description: 'Member removed', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

// ── Boards & Columns ──
registry.registerPath({
  method: 'post',
  path: '/workspaces/{id}/boards',
  tags: ['Boards'],
  summary: 'Create a new board with starter columns',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: createBoardSchema } } },
  },
  responses: {
    201: { description: 'Board created', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/workspaces/{id}/boards',
  tags: ['Boards'],
  summary: 'List boards in workspace',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'List of boards', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/boards/{id}',
  tags: ['Boards'],
  summary: 'Get board by ID (Cached in Redis)',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Board with columns', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/boards/{id}',
  tags: ['Boards'],
  summary: 'Update board name (invalidates cache)',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: updateBoardSchema } } },
  },
  responses: {
    200: { description: 'Board updated', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/boards/{id}',
  tags: ['Boards'],
  summary: 'Delete board',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Board deleted', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/boards/{id}/columns',
  tags: ['Boards'],
  summary: 'Add a column to a board',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: createColumnSchema } } },
  },
  responses: {
    201: { description: 'Column created', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/columns/{id}',
  tags: ['Boards'],
  summary: 'Update column name or position',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: updateColumnSchema } } },
  },
  responses: {
    200: { description: 'Column updated', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/columns/{id}',
  tags: ['Boards'],
  summary: 'Delete column',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Column deleted', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

// ── Tasks ──
registry.registerPath({
  method: 'post',
  path: '/columns/{id}/tasks',
  tags: ['Tasks'],
  summary: 'Create a task in a column (atomic with activity log & outbox)',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: createTaskSchema } } },
  },
  responses: {
    201: { description: 'Task created', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/tasks/{id}',
  tags: ['Tasks'],
  summary: 'Get full task details',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Task details', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/tasks/{id}',
  tags: ['Tasks'],
  summary: 'Update task fields with optimistic concurrency version check',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: updateTaskSchema } } },
  },
  responses: {
    200: { description: 'Task updated', content: { 'application/json': { schema: successResponseSchema } } },
    409: { description: 'Version conflict', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/tasks/{id}',
  tags: ['Tasks'],
  summary: 'Soft-delete a task',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Task deleted', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/tasks/{id}/move',
  tags: ['Tasks'],
  summary: 'Move/reorder a task using fractional positioning',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: moveTaskSchema } } },
  },
  responses: {
    200: { description: 'Task moved', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'put',
  path: '/tasks/{id}/assignees',
  tags: ['Tasks'],
  summary: 'Assign users to a task',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: updateAssigneesSchema } } },
  },
  responses: {
    200: { description: 'Assignees updated', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'put',
  path: '/tasks/{id}/tags',
  tags: ['Tasks'],
  summary: 'Set tags on a task',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: updateTagsSchema } } },
  },
  responses: {
    200: { description: 'Tags updated', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/tasks/{id}/subtasks',
  tags: ['Tasks'],
  summary: 'Add a subtask to a task',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: createSubtaskSchema } } },
  },
  responses: {
    201: { description: 'Subtask added', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/tasks/{taskId}/subtasks/{subtaskId}',
  tags: ['Tasks'],
  summary: 'Update subtask title or toggle completion',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ taskId: z.string().uuid(), subtaskId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: updateSubtaskSchema } } },
  },
  responses: {
    200: { description: 'Subtask updated', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/tasks/{taskId}/subtasks/{subtaskId}',
  tags: ['Tasks'],
  summary: 'Delete subtask',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ taskId: z.string().uuid(), subtaskId: z.string().uuid() }),
  },
  responses: {
    200: { description: 'Subtask deleted', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/tasks/{id}/comments',
  tags: ['Tasks'],
  summary: 'Post a comment on a task',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: createCommentSchema } } },
  },
  responses: {
    201: { description: 'Comment created', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/tasks/{id}/comments',
  tags: ['Tasks'],
  summary: 'List comments on a task',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'List of comments', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/boards/{id}/tasks',
  tags: ['Tasks'],
  summary: 'Search & filter board tasks with keyset cursor pagination',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    query: searchTasksQuerySchema,
  },
  responses: {
    200: { description: 'Paginated list of tasks with nextCursor', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

// ── Tags ──
registry.registerPath({
  method: 'post',
  path: '/workspaces/{id}/tags',
  tags: ['Tags'],
  summary: 'Create a tag in a workspace',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: createTagSchema } } },
  },
  responses: {
    201: { description: 'Tag created', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/workspaces/{id}/tags',
  tags: ['Tags'],
  summary: 'List tags in a workspace',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'List of tags', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

// ── Attachments ──
registry.registerPath({
  method: 'post',
  path: '/tasks/{id}/attachments/presign',
  tags: ['Attachments'],
  summary: 'Request pre-signed direct S3/R2 upload PUT URL',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: presignAttachmentSchema } } },
  },
  responses: {
    200: { description: 'Pre-signed upload URL and storage key', content: { 'application/json': { schema: successResponseSchema } } },
    400: { description: 'Forbidden MIME type or size exceeded', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/tasks/{id}/attachments/confirm',
  tags: ['Attachments'],
  summary: 'Confirm completed upload and record attachment in DB',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: confirmAttachmentSchema } } },
  },
  responses: {
    201: { description: 'Attachment saved', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/tasks/{id}/attachments',
  tags: ['Attachments'],
  summary: 'List attachments on task',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'List of attachments', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/attachments/{id}/url',
  tags: ['Attachments'],
  summary: 'Get pre-signed download GET URL for attachment',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Pre-signed download URL', content: { 'application/json': { schema: successResponseSchema } } },
    404: { description: 'Attachment not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/attachments/{id}',
  tags: ['Attachments'],
  summary: 'Delete attachment and underlying storage object',
  security: [{ bearerAuth: [] }],
  request: { params: idParamSchema },
  responses: {
    200: { description: 'Attachment deleted', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

// ── System ──
registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Process liveness health probe',
  responses: {
    200: { description: 'Process is alive', content: { 'application/json': { schema: successResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/ready',
  tags: ['System'],
  summary: 'Readiness probe verifying Postgres and Redis dependencies',
  responses: {
    200: { description: 'All dependencies ready' },
    503: { description: 'Dependencies degraded' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/metrics',
  tags: ['System'],
  summary: 'Prometheus metrics scrape endpoint',
  responses: {
    200: { description: 'Prometheus metrics output' },
  },
});

// Generate OpenAPI 3.0.3 specification
export const openApiDoc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'Enterprise Task Manager API',
    version: '1.0.0',
    description:
      'Enterprise-grade Trello/Asana-style backend REST API with realtime WebSockets, background queues, and S3 pre-signed attachments.',
  },
  servers: [
    { url: '/api/v1', description: 'API v1' },
    { url: '/', description: 'Root' },
  ],
});
