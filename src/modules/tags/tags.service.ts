import { tagsRepository, type TagsRepository } from './tags.repository.js';
import type { CreateTagInput } from './tags.schemas.js';
import { AppError } from '../../utils/app-error.js';

export class TagsService {
  constructor(private repo: TagsRepository = tagsRepository) {}

  async createTag(workspaceId: string, input: CreateTagInput) {
    const existing = await this.repo.findTagByName(workspaceId, input.name);
    if (existing) {
      throw new AppError(409, 'CONFLICT', 'A tag with this name already exists in this workspace');
    }
    return this.repo.createTag(workspaceId, input.name, input.color);
  }

  async getWorkspaceTags(workspaceId: string) {
    return this.repo.findTagsByWorkspace(workspaceId);
  }
}

export const tagsService = new TagsService();
