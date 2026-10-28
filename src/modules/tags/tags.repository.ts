import { prisma } from '../../config/prisma.js';
import type { Tag } from '../../generated/prisma/client.js';

export class TagsRepository {
  async createTag(workspaceId: string, name: string, color: string): Promise<Tag> {
    return prisma.tag.create({
      data: {
        workspaceId,
        name,
        color,
      },
    });
  }

  async findTagsByWorkspace(workspaceId: string): Promise<Tag[]> {
    return prisma.tag.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    });
  }

  async findTagByName(workspaceId: string, name: string): Promise<Tag | null> {
    return prisma.tag.findUnique({
      where: {
        workspaceId_name: {
          workspaceId,
          name,
        },
      },
    });
  }

  async findTagById(id: string): Promise<Tag | null> {
    return prisma.tag.findUnique({
      where: { id },
    });
  }
}

export const tagsRepository = new TagsRepository();
