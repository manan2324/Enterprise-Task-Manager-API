import { Router } from 'express';
import { boardsController } from './boards.controller.js';
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

export {
  boardsRouter,
  workspaceBoardsRouter,
  columnsRouter,
};

