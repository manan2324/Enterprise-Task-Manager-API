import { Router } from 'express';
import { boardsController } from './boards.controller.js';
import { columnTasksRouter, boardActivityRouter, boardTasksRouter } from '../tasks/tasks.routes.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { requireRole } from '../../middlewares/require-role.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import {
  createBoardSchema,
  updateBoardSchema,
  createColumnSchema,
  updateColumnSchema,
} from './boards.schemas.js';

const workspaceBoardsRouter = Router({ mergeParams: true });
const boardsRouter = Router();
const columnsRouter = Router();

// ── Workspace-scoped boards: /workspaces/:id/boards ──
workspaceBoardsRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: createBoardSchema }),
  asyncHandler(boardsController.createBoard),
);

workspaceBoardsRouter.get(
  '/',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(boardsController.listWorkspaceBoards),
);

// ── Direct board routes: /boards/:id ──
boardsRouter.get(
  '/:id',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(boardsController.getBoard),
);

boardsRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: updateBoardSchema }),
  asyncHandler(boardsController.updateBoard),
);

boardsRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(boardsController.deleteBoard),
);

// ── Board Activity: /boards/:id/activity ──
boardsRouter.use('/:id/activity', boardActivityRouter);

// ── Board Tasks search & pagination: /boards/:id/tasks ──
boardsRouter.use('/:id/tasks', boardTasksRouter);

// ── Columns under board: /boards/:id/columns ──
boardsRouter.post(
  '/:id/columns',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: createColumnSchema }),
  asyncHandler(boardsController.createColumn),
);

// ── Direct column routes: /columns/:id ──
columnsRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: updateColumnSchema }),
  asyncHandler(boardsController.updateColumn),
);

columnsRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(boardsController.deleteColumn),
);

// ── Column Tasks: /columns/:id/tasks ──
columnsRouter.use('/:id/tasks', columnTasksRouter);

export {
  boardsRouter,
  workspaceBoardsRouter,
  columnsRouter,
};

