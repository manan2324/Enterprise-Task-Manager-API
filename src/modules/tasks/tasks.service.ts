import { prisma } from '../../config/prisma.js';
import { tasksRepository, type TasksRepository } from './tasks.repository.js';
import { activityService, diff } from '../activity/activity.service.js';
import { between } from '../../utils/position.js';
import { decodeCursor } from '../../utils/pagination.js';
import { storageService } from '../../services/storage.service.js';
import { AppError } from '../../utils/app-error.js';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  MoveTaskInput,
  CreateSubtaskInput,
  UpdateSubtaskInput,
  CreateCommentInput,
  SearchTasksQuery,
  PresignAttachmentInput,
  ConfirmAttachmentInput,
} from './tasks.schemas.js';

export class TasksService {
  constructor(private repo: TasksRepository = tasksRepository) {}

  async createTask(actorId: string, columnId: string, input: CreateTaskInput) {
    const column = await this.repo.findColumn(columnId);
    if (!column) {
      throw new AppError(404, 'NOT_FOUND', 'Column not found');
    }
    const workspaceId = column.board.workspaceId;

    if (input.assigneeIds && input.assigneeIds.length > 0) {
      const valid = await this.repo.validateWorkspaceMembers(workspaceId, input.assigneeIds);
      if (!valid) {
        throw new AppError(400, 'BAD_REQUEST', 'One or more assignees are not members of this workspace');
      }
    }

    if (input.tagIds && input.tagIds.length > 0) {
      const valid = await this.repo.validateWorkspaceTags(workspaceId, input.tagIds);
      if (!valid) {
        throw new AppError(400, 'BAD_REQUEST', 'One or more tags do not belong to this workspace');
      }
    }

    let position = input.position;
    if (position === undefined) {
      const highest = await this.repo.findHighestTaskPosition(columnId);
      position = highest > 0 ? highest + 1000 : 1000;
    }

    const dueDate = input.dueDate ? new Date(input.dueDate) : null;

    return prisma.$transaction(async (tx) => {
      const task = await this.repo.createTaskWithRelations(tx, {
        columnId,
        workspaceId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        dueDate,
        position,
        createdById: actorId,
        assigneeIds: input.assigneeIds,
        tagIds: input.tagIds,
      });

      await activityService.record(tx, {
        workspaceId,
        actorId,
        entityType: 'task',
        entityId: task.id,
        action: 'task.created',
        metadata: {
          title: task.title,
          status: task.status,
          priority: task.priority,
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregate: 'task',
          aggregateId: task.id,
          type: 'task.created',
          payload: {
            taskId: task.id,
            boardId: column.board.id,
            workspaceId,
            title: task.title,
          },
        },
      });

      return task;
    });
  }

  async getTaskById(taskId: string) {
    const task = await this.repo.findTaskById(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }
    return task;
  }

  async updateTask(
    actorId: string,
    taskId: string,
    input: UpdateTaskInput,
    expectedVersion?: number,
  ) {
    const before = await this.repo.findTaskSummary(taskId);
    if (!before) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }

    const versionToCheck = input.version ?? expectedVersion;

    const dueDate = input.dueDate === null ? null : input.dueDate ? new Date(input.dueDate) : undefined;

    return prisma.$transaction(async (tx) => {
      const updateResult = await this.repo.updateTaskWithVersion(tx, taskId, versionToCheck, {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        dueDate,
      });

      if (updateResult.count === 0) {
        const latest = await tx.task.findUnique({ where: { id: taskId } });
        throw new AppError(409, 'VERSION_CONFLICT', 'Task was modified by another user', {
          currentVersion: latest?.version,
        });
      }

      const after = await tx.task.findUniqueOrThrow({ where: { id: taskId } });

      await activityService.record(tx, {
        workspaceId: before.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'task.updated',
        metadata: diff(before as Record<string, unknown>, after as Record<string, unknown>),
      });

      const col = await this.repo.findColumn(before.columnId);
      await tx.outboxEvent.create({
        data: {
          aggregate: 'task',
          aggregateId: taskId,
          type: 'task.updated',
          payload: {
            taskId,
            boardId: col?.board.id,
            workspaceId: before.workspaceId,
          },
        },
      });

      return after;
    });
  }

  async moveTask(
    actorId: string,
    taskId: string,
    input: MoveTaskInput,
    expectedVersion?: number,
  ) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }

    const targetColumn = await this.repo.findColumn(input.columnId);
    if (!targetColumn) {
      throw new AppError(404, 'NOT_FOUND', 'Target column not found');
    }

    if (targetColumn.board.workspaceId !== task.workspaceId) {
      throw new AppError(400, 'BAD_REQUEST', 'Cannot move task across different workspaces');
    }

    let beforePos: number | undefined;
    let afterPos: number | undefined;

    if (input.beforeTaskId) {
      const bTask = await this.repo.findTaskSummary(input.beforeTaskId);
      if (bTask) beforePos = Number(bTask.position);
    }

    if (input.afterTaskId) {
      const aTask = await this.repo.findTaskSummary(input.afterTaskId);
      if (aTask) afterPos = Number(aTask.position);
    }

    let newPosition: number;
    if (beforePos !== undefined || afterPos !== undefined) {
      newPosition = between(beforePos, afterPos);
    } else {
      const highest = await this.repo.findHighestTaskPosition(input.columnId);
      newPosition = highest > 0 ? highest + 1000 : 1000;
    }

    const versionToCheck = input.version ?? expectedVersion;

    return prisma.$transaction(async (tx) => {
      const updateResult = await this.repo.updateTaskWithVersion(tx, taskId, versionToCheck, {
        columnId: input.columnId,
        position: newPosition,
      });

      if (updateResult.count === 0) {
        const latest = await tx.task.findUnique({ where: { id: taskId } });
        throw new AppError(409, 'VERSION_CONFLICT', 'Task was modified by another user', {
          currentVersion: latest?.version,
        });
      }

      await activityService.record(tx, {
        workspaceId: task.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'task.moved',
        metadata: {
          fromColumnId: task.columnId,
          toColumnId: input.columnId,
          fromPosition: Number(task.position),
          toPosition: newPosition,
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregate: 'task',
          aggregateId: taskId,
          type: 'task.moved',
          payload: {
            taskId,
            boardId: targetColumn.board.id,
            workspaceId: task.workspaceId,
          },
        },
      });

      return tx.task.findUniqueOrThrow({ where: { id: taskId } });
    });
  }

  async deleteTask(actorId: string, taskId: string) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }

    await prisma.$transaction(async (tx) => {
      await this.repo.softDeleteTask(tx, taskId);

      await activityService.record(tx, {
        workspaceId: task.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'task.deleted',
      });

      const col = await this.repo.findColumn(task.columnId);
      await tx.outboxEvent.create({
        data: {
          aggregate: 'task',
          aggregateId: taskId,
          type: 'task.deleted',
          payload: {
            taskId,
            boardId: col?.board.id,
            workspaceId: task.workspaceId,
          },
        },
      });
    });

    return { message: 'Task deleted successfully' };
  }

  async updateAssignees(actorId: string, taskId: string, userIds: string[]) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }

    if (userIds.length > 0) {
      const valid = await this.repo.validateWorkspaceMembers(task.workspaceId, userIds);
      if (!valid) {
        throw new AppError(400, 'BAD_REQUEST', 'One or more assignees are not members of this workspace');
      }
    }

    const actor = await prisma.user.findUnique({ where: { id: actorId } });
    const users = await this.repo.findUsersByIds(userIds);
    const existingAssignees = await prisma.taskAssignee.findMany({
      where: { taskId },
      select: { userId: true },
    });
    const existingSet = new Set(existingAssignees.map((a) => a.userId));
    const newlyAdded = userIds.filter((uid) => !existingSet.has(uid));

    await prisma.$transaction(async (tx) => {
      await this.repo.updateAssignees(tx, taskId, userIds);

      await activityService.record(tx, {
        workspaceId: task.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'task.assigned',
        metadata: { assignees: userIds },
      });

      for (const uid of newlyAdded) {
        const u = users.find((x) => x.id === uid);
        if (u) {
          await tx.outboxEvent.create({
            data: {
              aggregate: 'task',
              aggregateId: taskId,
              type: 'task.assigned',
              payload: {
                taskId,
                taskTitle: task.title,
                userId: u.id,
                userEmail: u.email,
                actorName: actor?.name || 'A team member',
                workspaceId: task.workspaceId,
              },
            },
          });
        }
      }
    });

    return this.getTaskById(taskId);
  }

  async updateTags(actorId: string, taskId: string, tagIds: string[]) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }

    if (tagIds.length > 0) {
      const valid = await this.repo.validateWorkspaceTags(task.workspaceId, tagIds);
      if (!valid) {
        throw new AppError(400, 'BAD_REQUEST', 'One or more tags do not belong to this workspace');
      }
    }

    await prisma.$transaction(async (tx) => {
      await this.repo.updateTags(tx, taskId, tagIds);

      await activityService.record(tx, {
        workspaceId: task.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'task.tagged',
        metadata: { tags: tagIds },
      });
    });

    return this.getTaskById(taskId);
  }

  async createSubtask(actorId: string, taskId: string, input: CreateSubtaskInput) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }

    return prisma.$transaction(async (tx) => {
      const subtask = await this.repo.createSubtask(tx, taskId, input.title);

      await activityService.record(tx, {
        workspaceId: task.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'subtask.created',
        metadata: { subtaskId: subtask.id, title: subtask.title },
      });

      return subtask;
    });
  }

  async updateSubtask(
    actorId: string,
    taskId: string,
    subtaskId: string,
    input: UpdateSubtaskInput,
  ) {
    const subtask = await this.repo.findSubtaskById(subtaskId);
    if (!subtask || subtask.taskId !== taskId) {
      throw new AppError(404, 'NOT_FOUND', 'Subtask not found');
    }

    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.updateSubtask(tx, subtaskId, input);

      await activityService.record(tx, {
        workspaceId: task.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'subtask.updated',
        metadata: { subtaskId, done: updated.done, title: updated.title },
      });

      return updated;
    });
  }

  async deleteSubtask(actorId: string, taskId: string, subtaskId: string) {
    const subtask = await this.repo.findSubtaskById(subtaskId);
    if (!subtask || subtask.taskId !== taskId) {
      throw new AppError(404, 'NOT_FOUND', 'Subtask not found');
    }

    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }

    await prisma.$transaction(async (tx) => {
      await this.repo.deleteSubtask(tx, subtaskId);

      await activityService.record(tx, {
        workspaceId: task.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'subtask.deleted',
        metadata: { subtaskId },
      });
    });

    return { message: 'Subtask deleted successfully' };
  }

  async createComment(actorId: string, taskId: string, input: CreateCommentInput) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }

    return prisma.$transaction(async (tx) => {
      const comment = await this.repo.createComment(tx, taskId, actorId, input.body);

      await activityService.record(tx, {
        workspaceId: task.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'comment.created',
        metadata: { commentId: comment.id },
      });

      return comment;
    });
  }

  async getComments(taskId: string) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }
    return this.repo.findComments(taskId);
  }

  async getActivity(taskId: string) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) {
      throw new AppError(404, 'NOT_FOUND', 'Task not found');
    }
    return activityService.getTaskActivity(taskId);
  }

  async searchBoardTasks(boardId: string, query: SearchTasksQuery) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const dueBefore = query.dueBefore ? new Date(query.dueBefore) : undefined;
    const dueAfter = query.dueAfter ? new Date(query.dueAfter) : undefined;

    return this.repo.searchBoardTasks(boardId, {
      status: query.status,
      priority: query.priority,
      assignee: query.assignee,
      dueBefore,
      dueAfter,
      q: query.q,
      limit: query.limit,
      cursor,
    });
  }

  async presignAttachment(actorId: string, taskId: string, input: PresignAttachmentInput) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) throw new AppError(404, 'NOT_FOUND', 'Task not found');

    storageService.validateAttachment(input.mimeType, input.sizeBytes);
    const key = storageService.generateKey(task.workspaceId, taskId, input.fileName);
    return storageService.getPresignedUploadUrl(key, input.mimeType, input.sizeBytes);
  }

  async confirmAttachment(actorId: string, taskId: string, input: ConfirmAttachmentInput) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) throw new AppError(404, 'NOT_FOUND', 'Task not found');

    const expectedPrefix = `workspaces/${task.workspaceId}/tasks/${taskId}/`;
    if (!input.key.startsWith(expectedPrefix)) {
      throw new AppError(400, 'BAD_REQUEST', 'Attachment key does not match task location');
    }

    storageService.validateAttachment(input.mimeType, input.sizeBytes);

    return prisma.$transaction(async (tx) => {
      const attachment = await this.repo.createAttachment(tx, {
        taskId,
        key: input.key,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedBy: actorId,
      });

      await activityService.record(tx, {
        workspaceId: task.workspaceId,
        actorId,
        entityType: 'task',
        entityId: taskId,
        action: 'task.attachment_added',
        metadata: { attachmentId: attachment.id, fileName: attachment.fileName },
      });

      return attachment;
    });
  }

  async getAttachmentDownloadUrl(attachmentId: string) {
    const attachment = await this.repo.findAttachmentById(attachmentId);
    if (!attachment) throw new AppError(404, 'NOT_FOUND', 'Attachment not found');

    const downloadUrl = await storageService.getPresignedDownloadUrl(attachment.key);
    return {
      downloadUrl,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      expiresInSeconds: 900,
    };
  }

  async getTaskAttachments(taskId: string) {
    const task = await this.repo.findTaskSummary(taskId);
    if (!task) throw new AppError(404, 'NOT_FOUND', 'Task not found');

    return this.repo.findAttachments(taskId);
  }

  async deleteAttachment(actorId: string, attachmentId: string) {
    const attachment = await this.repo.findAttachmentById(attachmentId);
    if (!attachment) throw new AppError(404, 'NOT_FOUND', 'Attachment not found');

    await this.repo.deleteAttachment(attachmentId);
    await storageService.deleteFile(attachment.key);

    return { message: 'Attachment deleted successfully' };
  }
}

export const tasksService = new TasksService();
