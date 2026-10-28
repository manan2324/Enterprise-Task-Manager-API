-- Partition ActivityLog table by month (BUILD_GUIDE §13.4)

-- 1. Create partitioned table
CREATE TABLE "ActivityLog_partitioned" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_partitioned_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- 2. Create monthly partitions + default fallback partition
CREATE TABLE "ActivityLog_default" PARTITION OF "ActivityLog_partitioned" DEFAULT;

CREATE TABLE "ActivityLog_2026_09" PARTITION OF "ActivityLog_partitioned"
    FOR VALUES FROM ('2026-09-01 00:00:00') TO ('2026-10-01 00:00:00');

CREATE TABLE "ActivityLog_2026_10" PARTITION OF "ActivityLog_partitioned"
    FOR VALUES FROM ('2026-10-01 00:00:00') TO ('2026-11-01 00:00:00');

CREATE TABLE "ActivityLog_2026_11" PARTITION OF "ActivityLog_partitioned"
    FOR VALUES FROM ('2026-11-01 00:00:00') TO ('2026-12-01 00:00:00');

CREATE TABLE "ActivityLog_2026_12" PARTITION OF "ActivityLog_partitioned"
    FOR VALUES FROM ('2026-12-01 00:00:00') TO ('2027-01-01 00:00:00');

CREATE TABLE "ActivityLog_2027_01" PARTITION OF "ActivityLog_partitioned"
    FOR VALUES FROM ('2027-01-01 00:00:00') TO ('2027-02-01 00:00:00');

CREATE TABLE "ActivityLog_2027_02" PARTITION OF "ActivityLog_partitioned"
    FOR VALUES FROM ('2027-02-01 00:00:00') TO ('2027-03-01 00:00:00');

-- 3. Migrate existing records if any
INSERT INTO "ActivityLog_partitioned" SELECT * FROM "ActivityLog";

-- 4. Drop unpartitioned table and promote partitioned table
DROP TABLE "ActivityLog" CASCADE;

ALTER TABLE "ActivityLog_partitioned" RENAME TO "ActivityLog";

-- 5. Recreate indexes and foreign keys
CREATE INDEX "ActivityLog_workspaceId_createdAt_idx" ON "ActivityLog"("workspaceId", "createdAt");
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
