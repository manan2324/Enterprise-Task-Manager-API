import { Worker, type Job } from 'bullmq';
import { workerRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { captureException } from '../config/sentry.js';
import { emailService } from '../services/email.service.js';
import { prisma } from '../config/prisma.js';
import {
  dueRemindersQueue,
  type AssignmentEmailJobPayload,
  type DueReminderJobPayload,
} from './queues.js';
import { startOutboxRelay } from './outbox-relay.js';

/**
 * Triggers timezone-aware due date checks and enqueues daily digest reminders
 */
export async function dispatchDueReminders(): Promise<number> {
  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const dueTasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { not: 'DONE' },
      dueDate: {
        gte: now,
        lte: next24h,
      },
    },
    include: {
      assignees: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              timezone: true,
            },
          },
        },
      },
    },
  });

  // Group due tasks by user
  const userTasksMap = new Map<
    string,
    { email: string; tasks: Array<{ id: string; title: string; dueDate: string; priority: string }> }
  >();

  for (const task of dueTasks) {
    for (const assignee of task.assignees) {
      const user = assignee.user;
      let entry = userTasksMap.get(user.id);
      if (!entry) {
        entry = { email: user.email, tasks: [] };
        userTasksMap.set(user.id, entry);
      }

      entry.tasks.push({
        id: task.id,
        title: task.title,
        dueDate: task.dueDate?.toISOString() ?? '',
        priority: task.priority,
      });
    }
  }

  let dispatchedCount = 0;
  for (const [userId, { email, tasks }] of userTasksMap.entries()) {
    const todayStr = now.toISOString().slice(0, 10);
    await dueRemindersQueue.add(
      'send-due-reminder-digest',
      {
        userId,
        userEmail: email,
        tasks,
      },
      {
        jobId: `due-reminder:${userId}:${todayStr}`, // Prevent duplicate reminders on same date
      },
    );
    dispatchedCount++;
  }

  return dispatchedCount;
}

export function createAssignmentEmailWorker(): Worker<AssignmentEmailJobPayload> {
  const worker = new Worker<AssignmentEmailJobPayload>(
    'assignment-email',
    async (job: Job<AssignmentEmailJobPayload>) => {
      const { userEmail, taskTitle, actorName, taskId } = job.data;
      logger.info({ userEmail, taskId }, 'Processing assignment email job');
      await emailService.sendAssignmentEmail(userEmail, taskTitle, actorName, taskId);
    },
    {
      connection: workerRedis,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'Worker assignment email job failed');
    captureException(err, { jobId: job?.id, queue: 'assignment-email' });
  });

  return worker;
}

export function createDueRemindersWorker(): Worker<DueReminderJobPayload> {
  const worker = new Worker<DueReminderJobPayload>(
    'due-reminders',
    async (job: Job<DueReminderJobPayload>) => {
      const { userEmail, tasks } = job.data;
      logger.info({ userEmail, taskCount: tasks.length }, 'Processing due reminder digest job');
      await emailService.sendDueReminderDigest(userEmail, tasks);
    },
    {
      connection: workerRedis,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'Worker due reminders job failed');
    captureException(err, { jobId: job?.id, queue: 'due-reminders' });
  });

  return worker;
}

export interface WorkerRunner {
  assignmentWorker: Worker<AssignmentEmailJobPayload>;
  dueWorker: Worker<DueReminderJobPayload>;
  stop: () => Promise<void>;
}

export function startWorkers(): WorkerRunner {
  logger.info('Starting background job workers and transactional outbox relay');
  const outbox = startOutboxRelay(500);
  const assignmentWorker = createAssignmentEmailWorker();
  const dueWorker = createDueRemindersWorker();

  return {
    assignmentWorker,
    dueWorker,
    stop: async () => {
      outbox.stop();
      await assignmentWorker.close();
      await dueWorker.close();
    },
  };
}
