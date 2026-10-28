import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../generated/prisma/client.js';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/app-error.js';

export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

function getStringParam(val: unknown): string | null {
  if (typeof val === 'string' && val.length > 0) return val;
  if (Array.isArray(val) && typeof val[0] === 'string' && val[0].length > 0) return val[0];
  return null;
}

/**
 * Resolves the target workspace ID based on the URL parameters or context.
 * Returns null if the resource could not be found.
 */
export async function resolveWorkspaceId(req: Request): Promise<string | null> {
  // Direct workspace param
  const workspaceId = getStringParam(req.params['workspaceId']);
  if (workspaceId) {
    return workspaceId;
  }

  // Route matches /workspaces/:id
  if (req.baseUrl.includes('workspaces')) {
    const id = getStringParam(req.params['id']);
    if (id) return id;
  }

  // Route matches /boards/:id or has boardId
  const boardId =
    getStringParam(req.params['boardId']) ||
    (req.baseUrl.includes('boards') ? getStringParam(req.params['id']) : null);

  if (boardId) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { workspaceId: true },
    });
    return board?.workspaceId ?? null;
  }

  // Route matches /columns/:id or has columnId
  const columnId =
    getStringParam(req.params['columnId']) ||
    (req.baseUrl.includes('columns') ? getStringParam(req.params['id']) : null);

  if (columnId) {
    const column = await prisma.column.findUnique({
      where: { id: columnId },
      select: { boardId: true },
    });
    if (!column) return null;

    const board = await prisma.board.findUnique({
      where: { id: column.boardId },
      select: { workspaceId: true },
    });
    return board?.workspaceId ?? null;
  }

  // Route matches /tasks/:id or has taskId
  const taskId =
    getStringParam(req.params['taskId']) ||
    (req.baseUrl.includes('tasks') ? getStringParam(req.params['id']) : null);

  if (taskId) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    return task?.workspaceId ?? null;
  }

  // Route matches /subtasks/:id or has subtaskId
  const subtaskId =
    getStringParam(req.params['subtaskId']) ||
    (req.baseUrl.includes('subtasks') ? getStringParam(req.params['id']) : null);

  if (subtaskId) {
    const subtask = await prisma.subtask.findUnique({
      where: { id: subtaskId },
      select: { task: { select: { workspaceId: true } } },
    });
    return subtask?.task?.workspaceId ?? null;
  }

  // Route matches /attachments/:id or has attachmentId
  const attachmentId =
    getStringParam(req.params['attachmentId']) ||
    (req.baseUrl.includes('attachments') ? getStringParam(req.params['id']) : null);

  if (attachmentId) {
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { task: { select: { workspaceId: true } } },
    });
    return attachment?.task?.workspaceId ?? null;
  }

  if (typeof req.body === 'object' && req.body !== null && 'workspaceId' in req.body) {
    const bodyWsId = getStringParam((req.body as { workspaceId: unknown }).workspaceId);
    if (bodyWsId) return bodyWsId;
  }

  return null;
}

/**
 * Middleware factory requiring a minimum role in the target workspace.
 * Prevents IDOR by returning 404 for non-members to avoid leaking existence.
 */
export const requireRole = (minRole: Role) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const workspaceId = await resolveWorkspaceId(req);
    if (!workspaceId) {
      throw new AppError(404, 'NOT_FOUND', 'Resource not found');
    }

    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: req.user.id,
        },
      },
    });

    // Don't leak existence of private workspaces or resources to non-members
    if (!member) {
      throw new AppError(404, 'NOT_FOUND', 'Resource not found');
    }

    if (ROLE_RANK[member.role] < ROLE_RANK[minRole]) {
      throw new AppError(403, 'FORBIDDEN', 'Insufficient permissions for this action');
    }

    req.membership = member;
    req.workspaceId = workspaceId;
    next();
  };
};

