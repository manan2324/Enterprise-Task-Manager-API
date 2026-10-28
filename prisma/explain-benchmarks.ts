import pg from 'pg';
import 'dotenv/config';

const connectionString = process.env['DATABASE_URL'];
const pool = new pg.Pool({ connectionString });

async function explainQueries() {
  const client = await pool.connect();
  try {
    console.log('\n--- 1. Partition Pruning on ActivityLog (Range Oct 2026) ---');
    const partQuery = `
      EXPLAIN ANALYZE
      SELECT id, action, "createdAt"
      FROM "ActivityLog"
      WHERE "workspaceId" = 'ae6d1654-cc9a-48f4-aa83-28d6519587cc'
        AND "createdAt" >= '2026-10-01 00:00:00'
        AND "createdAt" < '2026-11-01 00:00:00'
      ORDER BY "createdAt" DESC
      LIMIT 50;
    `;
    const res1 = await client.query(partQuery);
    console.log(res1.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n'));

    console.log('\n--- 2. Keyset Cursor Pagination on 1,000,000 Tasks (Baseline) ---');
    const cursorQuery = `
      EXPLAIN ANALYZE
      SELECT t.id, t.title, t.status, t.priority, t."createdAt"
      FROM "Task" t
      JOIN "Column" c ON t."columnId" = c.id
      WHERE c."boardId" = '4f010ff3-8e72-4f5c-87e9-4ff21ecfcfce'
        AND t."deletedAt" IS NULL
        AND t.status = 'IN_PROGRESS'
        AND t.priority = 'HIGH'
      ORDER BY t."createdAt" DESC, t.id DESC
      LIMIT 20;
    `;
    const res2 = await client.query(cursorQuery);
    console.log(res2.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n'));

    // Create index to optimize board search and pagination
    console.log('\n--- Adding Optimized Composite Index on Task(columnId, status, priority, createdAt, id) ---');
    await client.query(`
      CREATE INDEX IF NOT EXISTS "Task_col_status_prio_created_idx"
      ON "Task"("columnId", status, priority, "createdAt" DESC, id DESC)
      WHERE "deletedAt" IS NULL;
    `);

    console.log('\n--- 2b. Keyset Cursor Pagination on 1,000,000 Tasks (Optimized with Partial Composite Index) ---');
    const res2b = await client.query(cursorQuery);
    console.log(res2b.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n'));

    console.log('\n--- 3. Optimistic Concurrency Update with Version on 1M rows ---');
    const updateQuery = `
      EXPLAIN ANALYZE
      UPDATE "Task"
      SET title = 'Updated Title', version = version + 1
      WHERE id = (SELECT id FROM "Task" LIMIT 1)
        AND version = 1
        AND "deletedAt" IS NULL;
    `;
    const res3 = await client.query(updateQuery);
    console.log(res3.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n'));

  } finally {
    client.release();
    await pool.end();
  }
}

explainQueries().catch(console.error);
