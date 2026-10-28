import type { Request, Response } from 'express';
import { tagsService, type TagsService } from './tags.service.js';
import { sendSuccess } from '../../utils/response.js';
import { getParam } from '../../utils/params.js';

export class TagsController {
  constructor(private service: TagsService = tagsService) {}

  createTag = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id') || getParam(req, 'workspaceId');
    const tag = await this.service.createTag(workspaceId, req.body);
    sendSuccess(res, 201, tag);
  };

  listTags = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id') || getParam(req, 'workspaceId');
    const tags = await this.service.getWorkspaceTags(workspaceId);
    sendSuccess(res, 200, tags);
  };
}

export const tagsController = new TagsController();
