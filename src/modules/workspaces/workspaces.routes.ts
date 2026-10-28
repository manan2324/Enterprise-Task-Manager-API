import { Router } from 'express';
import { workspacesController } from './workspaces.controller.js';
import { workspaceBoardsRouter } from '../boards/boards.routes.js';
import { workspaceTagsRouter } from '../tags/tags.routes.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { requireRole } from '../../middlewares/require-role.js';
import { validate } from '../../middlewares/validate.js';
import { idempotency } from '../../middlewares/idempotency.js';
import { asyncHandler } from '../../utils/async-handler.js';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  acceptInvitationSchema,
} from './workspaces.schemas.js';

const router = Router();
const invitationsRouter = Router();

// ── Workspaces CRUD ──
router.post(
  '/',
  authenticate,
  validate({ body: createWorkspaceSchema }),
  asyncHandler(workspacesController.create),
);

router.get(
  '/',
  authenticate,
  asyncHandler(workspacesController.list),
);

router.get(
  '/:id',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(workspacesController.getById),
);

router.patch(
  '/:id',
  authenticate,
  requireRole('OWNER'),
  validate({ body: updateWorkspaceSchema }),
  asyncHandler(workspacesController.update),
);

router.delete(
  '/:id',
  authenticate,
  requireRole('OWNER'),
  asyncHandler(workspacesController.delete),
);

// ── Workspace-scoped Boards ──
router.use('/:id/boards', workspaceBoardsRouter);

// ── Workspace-scoped Tags ──
router.use('/:id/tags', workspaceTagsRouter);

// ── Members & Invitations ──
router.get(
  '/:id/members',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(workspacesController.listMembers),
);

router.post(
  '/:id/invitations',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: inviteMemberSchema }),
  asyncHandler(workspacesController.invite),
);

router.patch(
  '/:id/members/:userId',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: updateMemberRoleSchema }),
  asyncHandler(workspacesController.updateMember),
);

router.delete(
  '/:id/members/:userId',
  authenticate,
  requireRole('VIEWER'), // Role matrix: self can leave; removing others requires ADMIN (checked in service)
  asyncHandler(workspacesController.removeMember),
);

// ── Standalone invitation accept route ──
invitationsRouter.post(
  '/accept',
  authenticate,
  idempotency,
  validate({ body: acceptInvitationSchema }),
  asyncHandler(workspacesController.acceptInvite),
);

export { router as workspaceRoutes, invitationsRouter };
