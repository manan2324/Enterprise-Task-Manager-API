import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processOutboxEvents } from '../../../src/jobs/outbox-relay.js';
import { prisma } from '../../../src/config/prisma.js';
import { cacheService } from '../../../src/services/cache.service.js';
import { assignmentEmailQueue } from '../../../src/jobs/queues.js';

vi.mock('../../../src/config/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    outboxEvent: {
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/cache.service.js', () => ({
  cacheService: {
    invalidateBoard: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/jobs/queues.js', () => ({
  assignmentEmailQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  },
  dueRemindersQueue: {
    add: vi.fn(),
  },
}));

describe('processOutboxEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when no pending outbox events exist', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    const count = await processOutboxEvents();
    expect(count).toBe(0);
  });

  it('dispatches task.created to cache invalidation and marks event processed', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: 101n,
        aggregate: 'task',
        aggregateId: 'task-1',
        type: 'task.created',
        payload: { boardId: 'board-99', taskId: 'task-1' },
        createdAt: new Date(),
        processedAt: null,
      },
    ] as never);

    const count = await processOutboxEvents();
    expect(count).toBe(1);
    expect(cacheService.invalidateBoard).toHaveBeenCalledWith('board-99');
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 101n },
      data: { processedAt: expect.any(Date) },
    });
  });

  it('dispatches task.assigned to BullMQ queue', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: 102n,
        aggregate: 'task',
        aggregateId: 'task-2',
        type: 'task.assigned',
        payload: {
          taskId: 'task-2',
          taskTitle: 'Important task',
          userId: 'user-77',
          userEmail: 'dev@example.com',
          actorName: 'Lead Dev',
        },
        createdAt: new Date(),
        processedAt: null,
      },
    ] as never);

    const count = await processOutboxEvents();
    expect(count).toBe(1);
    expect(assignmentEmailQueue.add).toHaveBeenCalledWith(
      'send-assignment-email',
      expect.objectContaining({
        taskId: 'task-2',
        userId: 'user-77',
        userEmail: 'dev@example.com',
      }),
      expect.objectContaining({
        jobId: 'assign:task-2:user-77',
      }),
    );
  });
});
