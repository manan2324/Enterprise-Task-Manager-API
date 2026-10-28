import client from 'prom-client';

// Collect standard Node.js runtime metrics (event loop lag, heap, GC, active handles)
client.collectDefaultMetrics({ prefix: 'taskmanager_' });

/**
 * RED Metrics: Rate (requests total)
 */
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total count of completed HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

/**
 * RED Metrics: Duration (request duration histogram)
 */
export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/**
 * Business & Domain Metrics
 */
export const tasksCreatedTotal = new client.Counter({
  name: 'tasks_created_total',
  help: 'Total number of tasks created',
});

export const outboxEventsProcessedTotal = new client.Counter({
  name: 'outbox_events_processed_total',
  help: 'Total count of transactional outbox events processed by relay',
});

export const idempotencyReplaysTotal = new client.Counter({
  name: 'idempotency_replays_total',
  help: 'Total number of idempotent responses served from cache',
});

export const register = client.register;
