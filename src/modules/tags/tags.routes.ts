import { Router } from 'express';
import { tagsController } from './tags.controller.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { requireRole } from '../../middlewares/require-role.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { createTagSchema } from './tags.schemas.js';

const workspaceTagsRouter = Router({ mergeParams: true });

workspaceTagsRouter.post(
  '/',
  authenticate,
  requireRole('MEMBER'),
  validate({ body: createTagSchema }),
  asyncHandler(tagsController.createTag),
);

workspaceTagsRouter.get(
  '/',
  authenticate,
  requireRole('VIEWER'),
  asyncHandler(tagsController.listTags),
);

export { workspaceTagsRouter };
