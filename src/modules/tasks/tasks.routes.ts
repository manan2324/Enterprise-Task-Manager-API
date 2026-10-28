import { Router } from 'express';
import { tasksController } from './tasks.controller.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { requireRole } from '../../middlewares/require-role.js';
import { validate } from '../../middlewares/validate.js';
import { idempotency } from '../../middlewares/idempotency.js';
import { asyncHandler } from '../../utils/async-handler.js';
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
} from './tasks.schemas.js';

const tasksRouter = Router();
const columnTasksRouter = Router({ mergeParams: true });
const boardActivityRouter = Router({ mergeParams: true });
const boardTasksRouter = Router({ mergeParams: true });
const attachmentsRouter = Router();

// ── Column-scoped task creation: /columns/:id/tasks ──
columnTasksRouter.post(
  '/',
  authenticate,
  requireRole('MEMBER'),
  idempotency,
  validate({ body: createTaskSchema }),
  asyncHandler(tasksController.createTask),
);

// ── Board-scoped task search and cursor pagination: /boards/:id/tasks ──
boardTasksRouter.get(
  '/',
  authenticate,
  requireRole('VIEWER'),
  validate({ query: searchTasksQuerySchema }),
  asyncHandler(tasksController.searchBoardTasks),
);

// ── Task detail, updates, and deletion ──
tasksRouter.get(
  '/:id',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(tasksController.getTask),
);

tasksRouter.patch(
  '/:id',
  authenticate,
  requireRole('MEMBER'),
  validate({ body: updateTaskSchema }),
  asyncHandler(tasksController.updateTask),
);

tasksRouter.patch(
  '/:id/move',
  authenticate,
  requireRole('MEMBER'),
  validate({ body: moveTaskSchema }),
  asyncHandler(tasksController.moveTask),
);

tasksRouter.delete(
  '/:id',
  authenticate,
  requireRole('MEMBER'),
  asyncHandler(tasksController.deleteTask),
);

// ── Assignees & Tags ──
tasksRouter.put(
  '/:id/assignees',
  authenticate,
  requireRole('MEMBER'),
  validate({ body: updateAssigneesSchema }),
  asyncHandler(tasksController.updateAssignees),
);

tasksRouter.put(
  '/:id/tags',
  authenticate,
  requireRole('MEMBER'),
  validate({ body: updateTagsSchema }),
  asyncHandler(tasksController.updateTags),
);

// ── Subtasks ──
tasksRouter.post(
  '/:id/subtasks',
  authenticate,
  requireRole('MEMBER'),
  validate({ body: createSubtaskSchema }),
  asyncHandler(tasksController.createSubtask),
);

tasksRouter.patch(
  '/:id/subtasks/:subtaskId',
  authenticate,
  requireRole('MEMBER'),
  validate({ body: updateSubtaskSchema }),
  asyncHandler(tasksController.updateSubtask),
);

tasksRouter.delete(
  '/:id/subtasks/:subtaskId',
  authenticate,
  requireRole('MEMBER'),
  asyncHandler(tasksController.deleteSubtask),
);

// ── Comments ──
tasksRouter.post(
  '/:id/comments',
  authenticate,
  requireRole('MEMBER'),
  idempotency,
  validate({ body: createCommentSchema }),
  asyncHandler(tasksController.createComment),
);

tasksRouter.get(
  '/:id/comments',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(tasksController.getComments),
);

// ── Attachments ──
tasksRouter.post(
  '/:id/attachments/presign',
  authenticate,
  requireRole('MEMBER'),
  validate({ body: presignAttachmentSchema }),
  asyncHandler(tasksController.presignAttachment),
);

tasksRouter.post(
  '/:id/attachments/confirm',
  authenticate,
  requireRole('MEMBER'),
  validate({ body: confirmAttachmentSchema }),
  asyncHandler(tasksController.confirmAttachment),
);

tasksRouter.get(
  '/:id/attachments',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(tasksController.listAttachments),
);

// ── Standalone Attachments Router: /attachments/:id/... ──
attachmentsRouter.get(
  '/:id/url',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(tasksController.getAttachmentUrl),
);

attachmentsRouter.delete(
  '/:id',
  authenticate,
  requireRole('MEMBER'),
  asyncHandler(tasksController.deleteAttachment),
);

// ── Activity Log ──
tasksRouter.get(
  '/:id/activity',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(tasksController.getTaskActivity),
);

// ── Board Activity: /boards/:id/activity ──
boardActivityRouter.get(
  '/',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(tasksController.getBoardActivity),
);

export {
  tasksRouter,
  columnTasksRouter,
  boardActivityRouter,
  boardTasksRouter,
  attachmentsRouter,
};
