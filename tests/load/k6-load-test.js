import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Custom metrics for SLO verification (§12, §19)
const readBoardTrend = new Trend('read_board_duration', true);
const searchTasksTrend = new Trend('search_tasks_duration', true);
const createTaskTrend = new Trend('create_task_duration', true);
const errorRate = new Rate('api_errors');

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3000';

export const options = {
  scenarios: {
    // 1. High-frequency reads (90% traffic): Cached board reads and indexed keyset searches
    read_traffic: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: 100, duration: '15s' }, // warm up
        { target: 300, duration: '30s' }, // ramp up to peak
        { target: 300, duration: '30s' }, // sustain peak
        { target: 0, duration: '15s' },   // ramp down
      ],
      exec: 'readWorkload',
    },
    // 2. Controlled writes (10% traffic): Task creation with idempotency keys
    write_traffic: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '90s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: 'writeWorkload',
    },
  },
  thresholds: {
    // SLO: Error rate < 0.1% (or < 1% under peak stress)
    http_req_failed: ['rate<0.01'],
    api_errors: ['rate<0.01'],
    // SLO: p95 latency < 400ms across all HTTP traffic
    http_req_duration: ['p(95)<400', 'p(99)<800'],
    // SLO: p95 cached board read < 150ms
    read_board_duration: ['p(95)<150'],
    // Keyset search across 1M rows < 250ms
    search_tasks_duration: ['p(95)<250'],
  },
};

// Setup: Authenticate and obtain JWT token + IDs
export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      email: 'owner@example.com',
      password: 'Password123!',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  let token;
  if (loginRes.status === 200) {
    token = loginRes.json('data.accessToken');
  } else {
    // Fallback to benchmark superuser
    const benchLogin = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({
        email: 'benchmark@example.com',
        password: 'Password123!',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    token = benchLogin.json('data.accessToken');
  }

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Find a board to run benchmarks on
  const wsRes = http.get(`${BASE_URL}/workspaces`, { headers: authHeaders });
  const workspaces = wsRes.json('data');
  const workspaceId = workspaces && workspaces.length > 0 ? workspaces[0].id : '';

  const boardsRes = http.get(`${BASE_URL}/workspaces/${workspaceId}/boards`, { headers: authHeaders });
  const boards = boardsRes.json('data');
  const boardId = boards && boards.length > 0 ? boards[0].id : '';

  const boardDetail = http.get(`${BASE_URL}/boards/${boardId}`, { headers: authHeaders });
  const columns = boardDetail.json('data.columns') || [];
  const columnId = columns.length > 0 ? columns[0].id : '';

  return {
    token,
    boardId,
    columnId,
    workspaceId,
  };
}

export function readWorkload(data) {
  const authHeaders = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  // 1. Cached Board Read (tests Redis cache-aside)
  const boardStart = Date.now();
  const boardRes = http.get(`${BASE_URL}/boards/${data.boardId}`, { headers: authHeaders });
  readBoardTrend.add(Date.now() - boardStart);

  const boardOk = check(boardRes, {
    'board read status is 200': (r) => r.status === 200,
  });
  if (!boardOk) errorRate.add(1);

  // 2. Keyset Cursor Search on 1M+ Task Dataset
  const searchStart = Date.now();
  const searchRes = http.get(
    `${BASE_URL}/boards/${data.boardId}/tasks?status=IN_PROGRESS&priority=HIGH&limit=20`,
    { headers: authHeaders },
  );
  searchTasksTrend.add(Date.now() - searchStart);

  const searchOk = check(searchRes, {
    'search tasks status is 200': (r) => r.status === 200,
  });
  if (!searchOk) errorRate.add(1);

  sleep(0.05);
}

export function writeWorkload(data) {
  if (!data.columnId) return;

  const idempotencyKey = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const authHeaders = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };

  const payload = JSON.stringify({
    title: `k6 Load Task ${__VU}-${__ITER}`,
    status: 'TODO',
    priority: 'MEDIUM',
  });

  const createStart = Date.now();
  const createRes = http.post(`${BASE_URL}/columns/${data.columnId}/tasks`, payload, {
    headers: authHeaders,
  });
  createTaskTrend.add(Date.now() - createStart);

  const createOk = check(createRes, {
    'task created status is 201': (r) => r.status === 201,
  });
  if (!createOk) errorRate.add(1);

  sleep(0.1);
}
