-- Scale Performance Query Optimization Indexes (BUILD_GUIDE §19)

-- 1. Optimized Board Columns lookup index
CREATE INDEX IF NOT EXISTS "Column_boardId_idx" ON "Column"("boardId");

-- 2. Optimized Keyset Pagination + Filter composite index on 1M+ tasks
CREATE INDEX IF NOT EXISTS "Task_columnId_status_priority_createdAt_id_idx"
ON "Task"("columnId", "status", "priority", "createdAt" DESC, "id" DESC);
