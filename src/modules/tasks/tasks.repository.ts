import { prisma } from '../../config/prisma.js';
import type { Prisma, Task, Subtask, Comment, Attachment } from '../../generated/prisma/client.js';
import { encodeCursor } from '../../utils/pagination.js';

export class TasksRepository {
  async findColumn(columnId: string) {
    return prisma.column.findUnique({
      where: { id: columnId },
      include: {
        board: {
          select: {
            id: true,
            workspaceId: true,
          },
        },
      },
    });
  }

  async findHighestTaskPosition(columnId: string): Promise<number> {
    const highest = await prisma.task.findFirst({
      where: { columnId, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return highest ? Number(highest.position) : 0;
  }

  async findTaskSummary(taskId: string) {
    return prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
    });
  }

  async findTaskById(taskId: string) {
    return prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: {
        column: {
          select: {
            id: true,
            name: true,
            boardId: true,
          },
        },
        subtasks: {
          orderBy: { id: 'asc' },
        },
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        tags: {
          include: {
            tag: true,
          },
        },
        _count: {
          select: {
            comments: true,
            attachments: true,
          },
        },
      },
    });
  }

  async createTaskWithRelations(
    tx: Prisma.TransactionClient,
    data: {
      columnId: string;
      workspaceId: string;
      title: string;
      description?: string;
      status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
      priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      dueDate?: Date | null;
      position: number;
      createdById: string;
      assigneeIds?: string[];
      tagIds?: string[];
    },
  ): Promise<Task> {
    return tx.task.create({
      data: {
        columnId: data.columnId,
        workspaceId: data.workspaceId,
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        dueDate: data.dueDate,
        position: data.position,
        createdById: data.createdById,
        assignees: data.assigneeIds && data.assigneeIds.length > 0
          ? {
              create: data.assigneeIds.map((userId) => ({ userId })),
            }
          : undefined,
        tags: data.tagIds && data.tagIds.length > 0
          ? {
              create: data.tagIds.map((tagId) => ({ tagId })),
            }
          : undefined,
      },
      include: {
        subtasks: true,
        assignees: true,
        tags: true,
      },
    });
  }

  async updateTaskWithVersion(
    tx: Prisma.TransactionClient,
    taskId: string,
    expectedVersion: number | undefined,
    data: {
      title?: string;
      description?: string | null;
      status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      dueDate?: Date | null;
      columnId?: string;
      position?: number;
    },
  ): Promise<{ count: number }> {
    const whereClause: Prisma.TaskWhereInput = {
      id: taskId,
      deletedAt: null,
    };

    if (expectedVersion !== undefined) {
      whereClause.version = expectedVersion;
    }

    const result = await tx.task.updateMany({
      where: whereClause,
      data: {
        ...data,
        version: { increment: 1 },
      },
    });

    return result;
  }

  async softDeleteTask(tx: Prisma.TransactionClient, taskId: string): Promise<void> {
    await tx.task.update({
      where: { id: taskId },
      data: { deletedAt: new Date() },
    });
  }

  async updateAssignees(
    tx: Prisma.TransactionClient,
    taskId: string,
    userIds: string[],
  ): Promise<void> {
    await tx.taskAssignee.deleteMany({ where: { taskId } });
    if (userIds.length > 0) {
      await tx.taskAssignee.createMany({
        data: userIds.map((userId) => ({ taskId, userId })),
      });
    }
  }

  async updateTags(
    tx: Prisma.TransactionClient,
    taskId: string,
    tagIds: string[],
  ): Promise<void> {
    await tx.taskTag.deleteMany({ where: { taskId } });
    if (tagIds.length > 0) {
      await tx.taskTag.createMany({
        data: tagIds.map((tagId) => ({ taskId, tagId })),
      });
    }
  }

  async createSubtask(
    tx: Prisma.TransactionClient,
    taskId: string,
    title: string,
  ): Promise<Subtask> {
    return tx.subtask.create({
      data: {
        taskId,
        title,
      },
    });
  }

  async findSubtaskById(subtaskId: string): Promise<Subtask | null> {
    return prisma.subtask.findUnique({
      where: { id: subtaskId },
    });
  }

  async updateSubtask(
    tx: Prisma.TransactionClient,
    subtaskId: string,
    data: { title?: string; done?: boolean },
  ): Promise<Subtask> {
    return tx.subtask.update({
      where: { id: subtaskId },
      data,
    });
  }

  async deleteSubtask(tx: Prisma.TransactionClient, subtaskId: string): Promise<void> {
    await tx.subtask.delete({
      where: { id: subtaskId },
    });
  }

  async createComment(
    tx: Prisma.TransactionClient,
    taskId: string,
    authorId: string,
    body: string,
  ): Promise<Comment> {
    return tx.comment.create({
      data: {
        taskId,
        authorId,
        body,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async findComments(taskId: string) {
    return prisma.comment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async validateWorkspaceMembers(workspaceId: string, userIds: string[]): Promise<boolean> {
    if (userIds.length === 0) return true;
    const count = await prisma.workspaceMember.count({
      where: {
        workspaceId,
        userId: { in: userIds },
      },
    });
    return count === userIds.length;
  }

  async validateWorkspaceTags(workspaceId: string, tagIds: string[]): Promise<boolean> {
    if (tagIds.length === 0) return true;
    const count = await prisma.tag.count({
      where: {
        workspaceId,
        id: { in: tagIds },
      },
    });
    return count === tagIds.length;
  }

  async searchBoardTasks(
    boardId: string,
    filters: {
      status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      assignee?: string;
      dueBefore?: Date;
      dueAfter?: Date;
      q?: string;
      limit: number;
      cursor?: { createdAt: Date; id: string } | null;
    },
  ) {
    const columns = await prisma.column.findMany({
      where: { boardId },
      select: { id: true },
    });

    if (columns.length === 0) {
      return { data: [], hasNext: false, nextCursor: null };
    }

    const baseWhere: Prisma.TaskWhereInput = {
      deletedAt: null,
      ...(filters.status && { status: filters.status }),
      ...(filters.priority && { priority: filters.priority }),
      ...(filters.assignee && { assignees: { some: { userId: filters.assignee } } }),
      ...(filters.dueBefore && { dueDate: { lte: filters.dueBefore } }),
      ...(filters.dueAfter && { dueDate: { gte: filters.dueAfter } }),
      ...(filters.q && {
        OR: [
          { title: { contains: filters.q, mode: 'insensitive' } },
          { description: { contains: filters.q, mode: 'insensitive' } },
        ],
      }),
      ...(filters.cursor && {
        OR: [
          { createdAt: { lt: filters.cursor.createdAt } },
          {
            AND: [
              { createdAt: filters.cursor.createdAt },
              { id: { lt: filters.cursor.id } },
            ],
          },
        ],
      }),
    };

    const taskInclude = {
      column: { select: { id: true, name: true } },
      assignees: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      tags: { include: { tag: true } },
    } as const;

    let items;
    const firstCol = columns[0];
    if (columns.length === 1 && firstCol) {
      items = await prisma.task.findMany({
        where: { ...baseWhere, columnId: firstCol.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: filters.limit + 1,
        include: taskInclude,
      });
    } else {
      // Parallel index scan per column to avoid PostgreSQL multi-column IN heapsort on 1M+ rows
      const perColumnResults = await Promise.all(
        columns.map((col) =>
          prisma.task.findMany({
            where: { ...baseWhere, columnId: col.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: filters.limit + 1,
            include: taskInclude,
          }),
        ),
      );

      items = perColumnResults
        .flat()
        .sort((a, b) => {
          const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
          if (timeDiff !== 0) return timeDiff;
          return b.id.localeCompare(a.id);
        })
        .slice(0, filters.limit + 1);
    }

    const hasNext = items.length > filters.limit;
    const data = hasNext ? items.slice(0, -1) : items;
    const lastItem = data[data.length - 1];
    const nextCursor =
      hasNext && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt, id: lastItem.id })
        : null;

    return { data, hasNext, nextCursor };
  }

  async createAttachment(
    tx: Prisma.TransactionClient,
    data: {
      taskId: string;
      key: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      uploadedBy: string;
    },
  ): Promise<Attachment> {
    return tx.attachment.create({
      data,
    });
  }

  async findAttachments(taskId: string): Promise<Attachment[]> {
    return prisma.attachment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAttachmentById(id: string) {
    return prisma.attachment.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            workspaceId: true,
          },
        },
      },
    });
  }

  async deleteAttachment(id: string): Promise<void> {
    await prisma.attachment.delete({
      where: { id },
    });
  }

  async findUsersByIds(ids: string[]) {
    return prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
  }
}

export const tasksRepository = new TasksRepository();
