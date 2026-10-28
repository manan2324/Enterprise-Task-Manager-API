import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';

export interface CleanupResult {
  outboxEventsPurged: number;
  refreshTokensPurged: number;
  invitationsPurged: number;
  idempotencyKeysPurged: number;
  softDeletedTasksPurged: number;
}

/**
 * Section 13.4: Keeping tables bounded.
 * Nightly maintenance job to purge stale records across high-churn tables.
 */
export async function runTableRetentionCleanup(): Promise<CleanupResult> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // 1. Purge processed OutboxEvents > 7 days old
  const outboxRes = await prisma.outboxEvent.deleteMany({
    where: {
      processedAt: { not: null, lt: sevenDaysAgo },
    },
  });

  // 2. Purge expired or revoked RefreshTokens
  const tokensRes = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { revokedAt: { not: null, lt: sevenDaysAgo } },
      ],
    },
  });

  // 3. Purge expired or accepted Invitations
  const invRes = await prisma.invitation.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { acceptedAt: { not: null, lt: sevenDaysAgo } },
      ],
    },
  });

  // 4. Purge expired IdempotencyKeys older than 24 hours
  const idemRes = await prisma.idempotencyKey.deleteMany({
    where: {
      createdAt: { lt: twentyFourHoursAgo },
    },
  });

  // 5. Hard-purge soft-deleted tasks older than 30 days
  const tasksRes = await prisma.task.deleteMany({
    where: {
      deletedAt: { not: null, lt: thirtyDaysAgo },
    },
  });

  const result: CleanupResult = {
    outboxEventsPurged: outboxRes.count,
    refreshTokensPurged: tokensRes.count,
    invitationsPurged: invRes.count,
    idempotencyKeysPurged: idemRes.count,
    softDeletedTasksPurged: tasksRes.count,
  };

  logger.info(result, 'Table retention cleanup completed');
  return result;
}
