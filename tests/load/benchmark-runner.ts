import http from 'node:http';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { signAccessToken } from '../../src/utils/token.js';

interface MetricStats {
  count: number;
  errors: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  avg: number;
  rps: number;
}

function calculatePercentiles(durations: number[], totalDurationSec: number, errors: number): MetricStats {
  if (durations.length === 0) {
    return { count: 0, errors, min: 0, max: 0, p50: 0, p90: 0, p95: 0, p99: 0, avg: 0, rps: 0 };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const p = (pct: number) => sorted[Math.min(Math.floor((pct / 100) * sorted.length), sorted.length - 1)];

  return {
    count: sorted.length,
    errors,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    p50: p(50) ?? 0,
    p90: p(90) ?? 0,
    p95: p(95) ?? 0,
    p99: p(99) ?? 0,
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    rps: Math.round(sorted.length / totalDurationSec),
  };
}

async function requestPromise(
  port: number,
  path: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; duration: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          const duration = Date.now() - start;
          try {
            const data = raw ? JSON.parse(raw) : null;
            resolve({ status: res.statusCode ?? 500, duration, data });
          } catch {
            resolve({ status: res.statusCode ?? 500, duration, data: raw });
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function runLoadBenchmark() {
  console.log('\n======================================================');
  console.log('⚡ HIGH-CONCURRENCY API LOAD BENCHMARK (BUILD_GUIDE §19)');
  console.log('======================================================\n');

  // Start HTTP server on dynamic port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const port = address.port;
  console.log(`📡 In-process test server listening on port ${port}`);

  // 1. Identify Superuser / Owner and Generate Direct JWT
  let user = await prisma.user.findFirst({
    where: { emailVerified: true },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'bench_runner@example.com',
        name: 'Benchmark Runner',
        emailVerified: true,
      },
    });
  }

  // 2. Identify Benchmark Board and Column
  let board = await prisma.board.findFirst({
    where: { name: 'Scale Benchmark Board' },
    include: { columns: true },
  });
  if (!board) {
    board = await prisma.board.findFirst({
      include: { columns: true },
    });
  }
  if (!board) throw new Error('No board found in database');

  // Ensure user is an OWNER or MEMBER of this workspace
  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: board.workspaceId,
        userId: user.id,
      },
    },
    update: { role: 'OWNER' },
    create: {
      workspaceId: board.workspaceId,
      userId: user.id,
      role: 'OWNER',
    },
  });

  const token = signAccessToken({ sub: user.id, email: user.email });
  const authHeaders = { Authorization: `Bearer ${token}` };

  const boardId = board.id;
  const columnId = board.columns[0]?.id;

  console.log(`🎯 Target Board: "${board.name}" (${boardId})`);
  console.log(`🎯 Target Column: "${board.columns[0]?.name}" (${columnId})\n`);

  // Warm up cache
  await requestPromise(port, `/boards/${boardId}`, 'GET', authHeaders);

  // ── Benchmark 1: Cached Board Reads (Redis Cache-Aside) ──
  console.log('--- 1. Benchmarking Cached Board Reads (/boards/:id) ---');
  const boardDurations: number[] = [];
  let boardErrors = 0;
  const boardStart = Date.now();
  const BOARD_REQUESTS = 1000;
  const CONCURRENCY = 50;

  for (let i = 0; i < BOARD_REQUESTS; i += CONCURRENCY) {
    const batch = Array.from({ length: CONCURRENCY }).map(async () => {
      try {
        const res = await requestPromise(port, `/boards/${boardId}`, 'GET', authHeaders);
        if (res.status === 200) {
          boardDurations.push(res.duration);
        } else {
          boardErrors++;
        }
      } catch {
        boardErrors++;
      }
    });
    await Promise.all(batch);
  }
  const boardStats = calculatePercentiles(boardDurations, (Date.now() - boardStart) / 1000, boardErrors);
  console.log(`   Requests: ${boardStats.count} | Errors: ${boardStats.errors} | Throughput: ${boardStats.rps} req/sec`);
  console.log(`   p50: ${boardStats.p50}ms | p90: ${boardStats.p90}ms | p95: ${boardStats.p95}ms | p99: ${boardStats.p99}ms | Avg: ${boardStats.avg}ms\n`);

  // ── Benchmark 2: Keyset Cursor Search on 1,000,000 Tasks ──
  console.log('--- 2. Benchmarking Keyset Search across 1M+ Tasks (/boards/:id/tasks) ---');
  const searchDurations: number[] = [];
  let searchErrors = 0;
  const searchStart = Date.now();
  const SEARCH_REQUESTS = 500;

  for (let i = 0; i < SEARCH_REQUESTS; i += 20) {
    const batch = Array.from({ length: 20 }).map(async (_, idx) => {
      try {
        const p = idx % 2 === 0 ? 'HIGH' : 'MEDIUM';
        const res = await requestPromise(
          port,
          `/boards/${boardId}/tasks?status=IN_PROGRESS&priority=${p}&limit=20`,
          'GET',
          authHeaders,
        );
        if (res.status === 200) {
          searchDurations.push(res.duration);
        } else {
          searchErrors++;
        }
      } catch {
        searchErrors++;
      }
    });
    await Promise.all(batch);
  }
  const searchStats = calculatePercentiles(searchDurations, (Date.now() - searchStart) / 1000, searchErrors);
  console.log(`   Requests: ${searchStats.count} | Errors: ${searchStats.errors} | Throughput: ${searchStats.rps} req/sec`);
  console.log(`   p50: ${searchStats.p50}ms | p90: ${searchStats.p90}ms | p95: ${searchStats.p95}ms | p99: ${searchStats.p99}ms | Avg: ${searchStats.avg}ms\n`);

  // ── Benchmark 3: Atomic Task Creation with ActivityLog + Outbox ──
  console.log('--- 3. Benchmarking Atomic Task Creation with Idempotency (/columns/:id/tasks) ---');
  const createDurations: number[] = [];
  let createErrors = 0;
  const createStart = Date.now();
  const CREATE_REQUESTS = 250;

  for (let i = 0; i < CREATE_REQUESTS; i += 10) {
    const batch = Array.from({ length: 10 }).map(async (_, idx) => {
      try {
        const key = `bench-${Date.now()}-${i}-${idx}-${Math.random()}`;
        const res = await requestPromise(
          port,
          `/columns/${columnId}/tasks`,
          'POST',
          { ...authHeaders, 'Idempotency-Key': key },
          JSON.stringify({
            title: `Benchmark Task ${i + idx}`,
            status: 'TODO',
            priority: 'HIGH',
          }),
        );
        if (res.status === 201) {
          createDurations.push(res.duration);
        } else {
          createErrors++;
        }
      } catch {
        createErrors++;
      }
    });
    await Promise.all(batch);
  }
  const createStats = calculatePercentiles(createDurations, (Date.now() - createStart) / 1000, createErrors);
  console.log(`   Requests: ${createStats.count} | Errors: ${createStats.errors} | Throughput: ${createStats.rps} req/sec`);
  console.log(`   p50: ${createStats.p50}ms | p90: ${createStats.p90}ms | p95: ${createStats.p95}ms | p99: ${createStats.p99}ms | Avg: ${createStats.avg}ms\n`);

  // Cleanup server
  await new Promise<void>((resolve) => server.close(() => resolve()));

  return {
    boardStats,
    searchStats,
    createStats,
  };
}

if (process.argv[1]?.endsWith('benchmark-runner.ts')) {
  runLoadBenchmark()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
