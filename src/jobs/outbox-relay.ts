import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { cacheService } from '../services/cache.service.js';
import { emitToBoard, emitToUser } from '../realtime/events.js';
import { assignmentEmailQueue } from './queues.js';

interface OutboxRecord {
  id: bigint;
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  processedAt: Date | null;
}

/**
 * Polls unhandled outbox events in a batch using FOR UPDATE SKIP LOCKED
 * and dispatches them reliably to WebSockets, Redis cache invalidation, and BullMQ queues.
 */
export async function processOutboxEvents(batchSize = 50): Promise<number> {
  const events = await prisma.$queryRaw<OutboxRecord[]>`
    SELECT id, aggregate, "aggregateId", type, payload, "createdAt", "processedAt"
    FROM "OutboxEvent"
    WHERE "processedAt" IS NULL
    ORDER BY id ASC
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  `;

  if (events.length === 0) {
    return 0;
  }

  for (const event of events) {
    try {
      const payload = event.payload;

      switch (event.type) {
        case 'task.created':
        case 'task.updated':
        case 'task.moved':
        case 'task.deleted': {
          const boardId = payload['boardId'] as string | undefined;
          if (boardId) {
            await cacheService.invalidateBoard(boardId);
            emitToBoard(boardId, event.type, payload);
          }
          break;
        }

        case 'task.assigned': {
          const userId = payload['userId'] as string | undefined;
          const taskId = payload['taskId'] as string;
          const taskTitle = (payload['taskTitle'] as string) || 'Task';
          const userEmail = payload['userEmail'] as string;
          const actorName = (payload['actorName'] as string) || 'A team member';

          if (userId && userEmail) {
            emitToUser(userId, 'task.assigned', payload);
            await assignmentEmailQueue.add(
              'send-assignment-email',
              {
                taskId,
                taskTitle,
                userId,
                userEmail,
                actorName,
              },
              {
                jobId: `assign:${taskId}:${userId}`,
              },
            );
          }
          break;
        }

        case 'board.invalidated': {
          const boardId = payload['boardId'] as string | undefined;
          if (boardId) {
            await cacheService.invalidateBoard(boardId);
            emitToBoard(boardId, 'board.updated', payload);
          }
          break;
        }

        default:
          logger.debug({ type: event.type }, 'Unhandled outbox event type');
      }

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    } catch (err) {
      logger.error({ err, eventId: Number(event.id) }, 'Failed to dispatch outbox event');
    }
  }

  return events.length;
}

/**
 * Runs a continuous relay interval loop in worker processes.
 */
export function startOutboxRelay(intervalMs = 500): { stop: () => void } {
  let running = true;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (!running) return;
    try {
      await processOutboxEvents();
    } catch (err) {
      logger.error({ err }, 'Error in outbox relay cycle');
    } finally {
      if (running) {
        timer = setTimeout(tick, intervalMs);
      }
    }
  };

  timer = setTimeout(tick, intervalMs);

  return {
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
