import type { Request, Response } from 'express';
import { workspacesService, type WorkspacesService } from './workspaces.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/app-error.js';
import { getParam } from '../../utils/params.js';

export class WorkspacesController {
  constructor(private service: WorkspacesService = workspacesService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const workspace = await this.service.createWorkspace(req.user.id, req.body);
    sendSuccess(res, 201, workspace);
  };

  list = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const workspaces = await this.service.getUserWorkspaces(req.user.id);
    sendSuccess(res, 200, workspaces);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id');
    const workspace = await this.service.getWorkspaceById(workspaceId);
    sendSuccess(res, 200, workspace);
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id');
    const workspace = await this.service.updateWorkspace(workspaceId, req.body);
    sendSuccess(res, 200, workspace);
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id');
    const result = await this.service.deleteWorkspace(workspaceId);
    sendSuccess(res, 200, result);
  };

  listMembers = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id');
    const members = await this.service.getMembers(workspaceId);
    sendSuccess(res, 200, members);
  };

  invite = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id');
    const actorRole = req.membership?.role;
    if (!actorRole) throw new AppError(403, 'FORBIDDEN');
    const invitation = await this.service.inviteMember(workspaceId, actorRole, req.body);
    sendSuccess(res, 201, invitation);
  };

  acceptInvite = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const result = await this.service.acceptInvitation(
      req.user.id,
      req.user.email,
      req.body.token,
    );
    sendSuccess(res, 200, result);
  };

  updateMember = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id');
    if (!req.user || !req.membership) throw new AppError(401, 'UNAUTHORIZED');
    const actorId = req.user.id;
    const actorRole = req.membership.role;
    const targetUserId = getParam(req, 'userId');

    const updated = await this.service.updateMemberRole(
      workspaceId,
      actorId,
      actorRole,
      targetUserId,
      req.body,
    );
    sendSuccess(res, 200, updated);
  };

  removeMember = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id');
    if (!req.user || !req.membership) throw new AppError(401, 'UNAUTHORIZED');
    const actorId = req.user.id;
    const actorRole = req.membership.role;
    const targetUserId = getParam(req, 'userId');

    const result = await this.service.removeMember(
      workspaceId,
      actorId,
      actorRole,
      targetUserId,
    );
    sendSuccess(res, 200, result);
  };
}

export const workspacesController = new WorkspacesController();
