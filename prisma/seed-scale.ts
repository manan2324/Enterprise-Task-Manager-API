import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import pg from 'pg';
import 'dotenv/config';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL is required in environment');
}

const pool = new pg.Pool({ connectionString, max: 10 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEMO_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$dGVzdHNhbHQxMjM0NTY3OA$t45W2Zl1h0ZJkWqL8e0i6s+rV9bH3M6u7p0gQ1dE2aA';

interface ScaleSeedOptions {
  taskCount: number;
  activityCount: number;
  batchSize: number;
}

export async function runScaleSeed(options?: Partial<ScaleSeedOptions>): Promise<void> {
  const targetTasks = options?.taskCount ?? parseInt(process.env['TARGET_TASKS'] ?? '1000000', 10);
  const targetActivities = options?.activityCount ?? parseInt(process.env['TARGET_ACTIVITIES'] ?? '1000000', 10);
  const batchSize = options?.batchSize ?? 50000;

  console.log(`\n======================================================`);
  console.log(`🚀 ENTERPRISE SCALE SEED BENCHMARK (BUILD_GUIDE §19)`);
  console.log(`Target Tasks: ${targetTasks.toLocaleString()}`);
  console.log(`Target Activity Logs: ${targetActivities.toLocaleString()} (Partitioned)`);
  console.log(`Batch Size: ${batchSize.toLocaleString()}`);
  console.log(`======================================================\n`);

  const startTime = Date.now();

  // 1. Ensure Benchmark User & Workspace Exist
  let user = await prisma.user.findUnique({ where: { email: 'benchmark@example.com' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'benchmark@example.com',
        name: 'Benchmark Superuser',
        passwordHash: DEMO_PASSWORD_HASH,
        emailVerified: true,
      },
    });
  }

  let workspace = await prisma.workspace.findUnique({ where: { slug: 'benchmark-enterprise' } });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Benchmark Enterprise Scale Workspace',
        slug: 'benchmark-enterprise',
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    });
  }

  let board = await prisma.board.findFirst({ where: { workspaceId: workspace.id, name: 'Scale Benchmark Board' } });
  if (!board) {
    board = await prisma.board.create({
      data: {
        workspaceId: workspace.id,
        name: 'Scale Benchmark Board',
        columns: {
          create: [
            { name: 'Backlog', position: 1000 },
            { name: 'In Progress', position: 2000 },
            { name: 'Review', position: 3000 },
            { name: 'Done', position: 4000 },
          ],
        },
      },
    });
  }

  const columns = await prisma.column.findMany({ where: { boardId: board.id } });
  const colIds = columns.map((c) => c.id);

  console.log(`✅ Base workspace "${workspace.name}" and board ready (${colIds.length} columns).`);

  // 2. High-Throughput Bulk Generation of Tasks
  console.log(`\n📦 Generating ${targetTasks.toLocaleString()} Tasks using PostgreSQL set generation...`);
  const tasksStart = Date.now();
  let tasksInserted = 0;

  for (let from = 1; from <= targetTasks; from += batchSize) {
    const to = Math.min(from + batchSize - 1, targetTasks);
    const assignedColId = colIds[tasksInserted % colIds.length];

    await prisma.$executeRaw`
      INSERT INTO "Task" (
        id,
        "columnId",
        "workspaceId",
        title,
        description,
        status,
        priority,
        "dueDate",
        position,
        "createdById",
        version,
        "createdAt",
        "updatedAt"
      )
      SELECT
        gen_random_uuid()::text,
        ${assignedColId},
        ${workspace.id},
        'Task #' || i || ' - High concurrency load benchmark payload ' || (i % 500),
        'Synthetic description for performance profiling and index scan verification under 1M+ dataset.',
        (ARRAY['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']::"TaskStatus"[])[1 + (i % 4)],
        (ARRAY['LOW', 'MEDIUM', 'HIGH', 'URGENT']::"Priority"[])[1 + (i % 4)],
        NOW() + (((i % 60) - 30) * INTERVAL '1 day'),
        (i * 10.0)::numeric(20, 10),
        ${user.id},
        1,
        NOW() - ((i % 180) * INTERVAL '1 day'),
        NOW()
      FROM generate_series(${from}::int, ${to}::int) AS i;
    `;

    tasksInserted += to - from + 1;
    const progress = ((tasksInserted / targetTasks) * 100).toFixed(1);
    const rate = Math.round(tasksInserted / ((Date.now() - tasksStart) / 1000));
    process.stdout.write(`   ↳ [Tasks] ${tasksInserted.toLocaleString()}/${targetTasks.toLocaleString()} (${progress}%) at ~${rate.toLocaleString()} rows/sec\r`);
  }

  const tasksDurationSec = ((Date.now() - tasksStart) / 1000).toFixed(2);
  console.log(`\n✨ Successfully seeded ${tasksInserted.toLocaleString()} tasks in ${tasksDurationSec}s!`);

  // 3. High-Throughput Bulk Generation of Partitioned Activity Logs
  console.log(`\n📊 Generating ${targetActivities.toLocaleString()} Partitioned ActivityLog rows...`);
  const activityStart = Date.now();
  let activitiesInserted = 0;

  for (let from = 1; from <= targetActivities; from += batchSize) {
    const to = Math.min(from + batchSize - 1, targetActivities);

    await prisma.$executeRaw`
      INSERT INTO "ActivityLog" (
        id,
        "workspaceId",
        "actorId",
        "entityType",
        "entityId",
        action,
        metadata,
        "createdAt"
      )
      SELECT
        gen_random_uuid()::text,
        ${workspace.id},
        ${user.id},
        'task',
        gen_random_uuid()::text,
        (ARRAY['task.created', 'task.updated', 'task.moved', 'task.assigned']::text[])[1 + (i % 4)],
        jsonb_build_object('batch', i / 10000, 'metric', 'scale-test', 'index', i),
        -- Distribute createdAt across partitioned months: Sep 2026 to Jan 2027
        TIMESTAMP '2026-09-01 00:00:00' + ((i % 150) * INTERVAL '1 day') + ((i % 86400) * INTERVAL '1 second')
      FROM generate_series(${from}::int, ${to}::int) AS i;
    `;

    activitiesInserted += to - from + 1;
    const progress = ((activitiesInserted / targetActivities) * 100).toFixed(1);
    const rate = Math.round(activitiesInserted / ((Date.now() - activityStart) / 1000));
    process.stdout.write(`   ↳ [ActivityLog] ${activitiesInserted.toLocaleString()}/${targetActivities.toLocaleString()} (${progress}%) at ~${rate.toLocaleString()} rows/sec\r`);
  }

  const activityDurationSec = ((Date.now() - activityStart) / 1000).toFixed(2);
  console.log(`\n✨ Successfully seeded ${activitiesInserted.toLocaleString()} partitioned ActivityLog rows in ${activityDurationSec}s!`);

  // 4. Update PostgreSQL table statistics for optimal query plans
  console.log(`\n🔍 Running ANALYZE on Task and ActivityLog to refresh query planner statistics...`);
  await prisma.$executeRawUnsafe('ANALYZE "Task";');
  await prisma.$executeRawUnsafe('ANALYZE "ActivityLog";');

  const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n======================================================`);
  console.log(`🏁 SCALE SEEDING COMPLETE in ${totalDurationSec}s!`);
  console.log(`Total Rows Inserted: ${(tasksInserted + activitiesInserted).toLocaleString()}`);
  console.log(`Benchmark Board ID: ${board.id}`);
  console.log(`Benchmark Workspace ID: ${workspace.id}`);
  console.log(`======================================================\n`);
}

// Run if directly executed
if (process.argv[1]?.endsWith('seed-scale.ts')) {
  runScaleSeed()
    .catch((err) => {
      console.error('❌ Scale seed failed:', err);
      process.exit(1);
    })
    .finally(() => {
      void prisma.$disconnect();
      void pool.end();
    });
}
