import { describe, it, expect, vi } from 'vitest';
import { diff, ActivityService } from '../../../src/modules/activity/activity.service.js';
import type { Prisma } from '../../../src/generated/prisma/client.js';

describe('ActivityService and diff utility', () => {
  it('computes field-level differences correctly', () => {
    const before = {
      title: 'Original Title',
      status: 'TODO',
      version: 1,
      updatedAt: new Date('2026-01-01'),
    };
    const after = {
      title: 'Updated Title',
      status: 'DONE',
      version: 2,
      updatedAt: new Date('2026-01-02'),
    };

    const changes = diff(before, after);
    expect(changes).toEqual({
      title: { from: 'Original Title', to: 'Updated Title' },
      status: { from: 'TODO', to: 'DONE' },
    });
    // version and updatedAt should be ignored by default
    expect(changes['version']).toBeUndefined();
    expect(changes['updatedAt']).toBeUndefined();
  });

  it('records activity using the provided transaction client', async () => {
    const mockTx = {
      activityLog: {
        create: vi.fn().mockResolvedValue({ id: 'act-1' }),
      },
    } as unknown as Prisma.TransactionClient;

    const service = new ActivityService();
    await service.record(mockTx, {
      workspaceId: 'ws-1',
      actorId: 'usr-1',
      entityType: 'task',
      entityId: 'tsk-1',
      action: 'task.created',
      metadata: { title: 'New Task' },
    });

    expect(mockTx.activityLog.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws-1',
        actorId: 'usr-1',
        entityType: 'task',
        entityId: 'tsk-1',
        action: 'task.created',
        metadata: { title: 'New Task' },
      },
    });
  });
});
