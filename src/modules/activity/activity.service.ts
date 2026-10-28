import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';

export interface RecordActivityInput {
  workspaceId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Computes a field-by-field diff between two objects, omitting ignored properties.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignoredKeys = new Set(['updatedAt', 'version', 'createdAt']),
): Prisma.InputJsonObject {
  const result: Record<string, { from: unknown; to: unknown }> = {};

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    if (ignoredKeys.has(key)) continue;

    const valBefore = before[key];
    const valAfter = after[key];

    // Normalize Date objects to ISO string for comparison
    const normBefore = valBefore instanceof Date ? valBefore.toISOString() : valBefore;
    const normAfter = valAfter instanceof Date ? valAfter.toISOString() : valAfter;

    if (JSON.stringify(normBefore) !== JSON.stringify(normAfter)) {
      result[key] = {
        from: valBefore ?? null,
        to: valAfter ?? null,
      };
    }
  }

  return result as unknown as Prisma.InputJsonObject;
}

export class ActivityService {
  /**
   * Records an activity log entry inside an existing database transaction client.
   * If the transaction rolls back, this entry will roll back as well.
   */
  async record(
    tx: Prisma.TransactionClient,
    input: RecordActivityInput,
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  /**
   * Fetches activity logs for a specific task.
   */
  async getTaskActivity(taskId: string, limit = 50) {
    return prisma.activityLog.findMany({
      where: {
        entityType: 'task',
        entityId: taskId,
      },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Fetches activity logs for a board (workspace-scoped activity filtered by board or workspace).
   */
  async getBoardActivity(boardId: string, limit = 50) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { workspaceId: true },
    });
    if (!board) return [];

    return prisma.activityLog.findMany({
      where: {
        workspaceId: board.workspaceId,
      },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const activityService = new ActivityService();
