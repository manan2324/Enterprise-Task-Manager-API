import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTableRetentionCleanup } from '../../../src/jobs/cleanup.js';
import { prisma } from '../../../src/config/prisma.js';

describe('Table Retention Cleanup Job (§13.4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('purges processed outbox events, expired tokens, old invitations, idempotency keys, and soft-deleted tasks', async () => {
    const deleteManyOutboxSpy = vi.spyOn(prisma.outboxEvent, 'deleteMany').mockResolvedValue({ count: 12 });
    const deleteManyTokensSpy = vi.spyOn(prisma.refreshToken, 'deleteMany').mockResolvedValue({ count: 5 });
    const deleteManyInvitationsSpy = vi.spyOn(prisma.invitation, 'deleteMany').mockResolvedValue({ count: 3 });
    const deleteManyIdempotencySpy = vi.spyOn(prisma.idempotencyKey, 'deleteMany').mockResolvedValue({ count: 8 });
    const deleteManyTasksSpy = vi.spyOn(prisma.task, 'deleteMany').mockResolvedValue({ count: 2 });

    const result = await runTableRetentionCleanup();

    expect(result).toEqual({
      outboxEventsPurged: 12,
      refreshTokensPurged: 5,
      invitationsPurged: 3,
      idempotencyKeysPurged: 8,
      softDeletedTasksPurged: 2,
    });

    expect(deleteManyOutboxSpy).toHaveBeenCalledTimes(1);
    expect(deleteManyTokensSpy).toHaveBeenCalledTimes(1);
    expect(deleteManyInvitationsSpy).toHaveBeenCalledTimes(1);
    expect(deleteManyIdempotencySpy).toHaveBeenCalledTimes(1);
    expect(deleteManyTasksSpy).toHaveBeenCalledTimes(1);
  });
});
