import { Queue } from 'bullmq';
import { queueRedis } from '../config/redis.js';

export interface AssignmentEmailJobPayload {
  taskId: string;
  taskTitle: string;
  userId: string;
  userEmail: string;
  actorName: string;
  workspaceName?: string;
}

export interface DueReminderJobPayload {
  userId: string;
  userEmail: string;
  tasks: Array<{
    id: string;
    title: string;
    dueDate: string;
    priority: string;
  }>;
}

/**
 * Queue for processing task assignment email notifications
 */
export const assignmentEmailQueue = new Queue<AssignmentEmailJobPayload>('assignment-email', {
  connection: queueRedis,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

/**
 * Queue for processing timezone-aware daily due reminders
 */
export const dueRemindersQueue = new Queue<DueReminderJobPayload>('due-reminders', {
  connection: queueRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});
