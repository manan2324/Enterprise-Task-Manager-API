import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { logger } from './config/logger.js';
import { env } from './config/env.js';
import { requestId } from './middlewares/request-id.js';
import { errorHandler } from './middlewares/error-handler.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { workspaceRoutes, invitationsRouter } from './modules/workspaces/workspaces.routes.js';
import { boardsRouter, columnsRouter } from './modules/boards/boards.routes.js';
import { tasksRouter, attachmentsRouter } from './modules/tasks/tasks.routes.js';

const app = express();

// ── Security ──
app.use(helmet());
app.use(
  cors({
    origin: env.APP_URL,
    credentials: true,
  }),
);

// ── Parsing ──
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Request ID + logging ──
app.use(requestId);
const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => ((req as { id?: string }).id ?? ''),
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
});
app.use((req, res, next) => {
  httpLogger(req, res, next);
});

// Trust proxy for accurate client IPs behind load balancer
app.set('trust proxy', 1);

// ── Health & Readiness ──
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const withTimeout = async <T>(promise: Promise<T>, ms = 2000): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Probe timeout')), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

app.get('/ready', async (_req, res) => {
  const checks: Record<string, string> = {};

  try {
    await withTimeout(prisma.$queryRawUnsafe('SELECT 1'));
    checks['database'] = 'ok';
  } catch {
    checks['database'] = 'error';
  }

  try {
    const pong = await withTimeout(redis.ping());
    checks['redis'] = pong === 'PONG' ? 'ok' : 'error';
  } catch {
    checks['redis'] = 'error';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ready' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

// ── Module routes ──

//auth
app.use('/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);

//workspace
app.use('/workspaces', workspaceRoutes);
app.use('/api/v1/workspaces', workspaceRoutes);

//invitations
app.use('/invitations', invitationsRouter);
app.use('/api/v1/invitations', invitationsRouter);

//boards
app.use('/boards', boardsRouter);
app.use('/api/v1/boards', boardsRouter);

//columns
app.use('/columns', columnsRouter);
app.use('/api/v1/columns', columnsRouter);

//tasks
app.use('/tasks', tasksRouter);
app.use('/api/v1/tasks', tasksRouter);

//attachments
app.use('/attachments', attachmentsRouter);
app.use('/api/v1/attachments', attachmentsRouter);

// ── 404 handler ──
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
  });
});

// ── Central error handler (must be last) ──
app.use(errorHandler);

export { app };
