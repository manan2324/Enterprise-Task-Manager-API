import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { cacheRedis } from '../../src/config/redis.js';
import { processOutboxEvents } from '../../src/jobs/outbox-relay.js';
import { dispatchDueReminders, createAssignmentEmailWorker, createDueRemindersWorker } from '../../src/jobs/worker.js';
import {
  createTestUser,
  authHeader,
  createTestWorkspace,
  addMemberToWorkspace,
} from '../helpers/test-utils.js';

describe('Step 37 Advanced Features Integration', () => {
  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let outsideUser: { id: string; email: string };
  let workspace: { id: string };
  let board: { id: string };
  let column: { id: string };

  beforeEach(async () => {
    // Clear outbox events and cached keys
    await prisma.outboxEvent.deleteMany({});
    const keys = await cacheRedis.keys('board:*');
    if (keys.length > 0) {
      await cacheRedis.del(...keys);
    }

    ownerUser = await createTestUser('adv_owner@example.com', 'Advanced Owner');
    memberUser = await createTestUser('adv_member@example.com', 'Advanced Member');
    outsideUser = await createTestUser('adv_outside@example.com', 'Advanced Outside');

    workspace = await createTestWorkspace(ownerUser.id, 'Advanced Test WS');
    await addMemberToWorkspace(workspace.id, memberUser.id, 'MEMBER');

    const boardRes = await request(app)
      .post(`/workspaces/${workspace.id}/boards`)
      .set('Authorization', authHeader(ownerUser))
      .send({ name: 'Advanced Sprint Board' });

    board = boardRes.body.data;
    column = boardRes.body.data.columns[0];
  });

  afterAll(async () => {
    const keys = await cacheRedis.keys('board:*');
    if (keys.length > 0) {
      await cacheRedis.del(...keys);
    }
  });

  describe('Search & Filter with Cursor Pagination (GET /boards/:id/tasks)', () => {
    beforeEach(async () => {
      // Create test tasks with various statuses and priorities
      await request(app)
        .post(`/columns/${column.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({
          title: 'Implement Redis Caching',
          description: 'Use cache-aside pattern for boards',
          status: 'TODO',
          priority: 'URGENT',
        });

      await request(app)
        .post(`/columns/${column.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({
          title: 'Setup BullMQ Workers',
          description: 'Process background jobs and emails',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
        });

      await request(app)
        .post(`/columns/${column.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({
          title: 'Configure Socket.io',
          description: 'Real-time WebSocket event dispatching',
          status: 'DONE',
          priority: 'LOW',
        });

      await request(app)
        .post(`/columns/${column.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({
          title: 'S3 Presigned URLs',
          description: 'Direct browser uploads to object storage',
          status: 'TODO',
          priority: 'MEDIUM',
        });
    });

    it('filters tasks by status and priority', async () => {
      const res = await request(app)
        .get(`/boards/${board.id}/tasks?status=TODO&priority=URGENT`)
        .set('Authorization', authHeader(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Implement Redis Caching');
      expect(res.body.data[0].status).toBe('TODO');
      expect(res.body.data[0].priority).toBe('URGENT');
    });

    it('searches tasks by text query (q)', async () => {
      const res = await request(app)
        .get(`/boards/${board.id}/tasks?q=WebSocket`)
        .set('Authorization', authHeader(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Configure Socket.io');
    });

    it('paginates results across pages using keyset cursor pagination', async () => {
      // Fetch Page 1 with limit=2
      const page1Res = await request(app)
        .get(`/boards/${board.id}/tasks?limit=2`)
        .set('Authorization', authHeader(memberUser));

      expect(page1Res.status).toBe(200);
      expect(page1Res.body.data).toHaveLength(2);
      expect(page1Res.body.meta.hasNext).toBe(true);
      expect(page1Res.body.meta.nextCursor).toBeDefined();

      const nextCursor = page1Res.body.meta.nextCursor;
      const page1Ids = page1Res.body.data.map((t: { id: string }) => t.id);

      // Fetch Page 2 with cursor
      const page2Res = await request(app)
        .get(`/boards/${board.id}/tasks?limit=2&cursor=${encodeURIComponent(nextCursor)}`)
        .set('Authorization', authHeader(memberUser));

      expect(page2Res.status).toBe(200);
      expect(page2Res.body.data.length).toBeGreaterThanOrEqual(1);

      const page2Ids = page2Res.body.data.map((t: { id: string }) => t.id);
      // Ensure no duplicates between pages
      for (const id of page2Ids) {
        expect(page1Ids).not.toContain(id);
      }
    });
  });

  describe('Redis Board Cache with Invalidation', () => {
    it('caches board read in Redis and invalidates after task mutation', async () => {
      const cacheKey = `board:${board.id}:v1`;

      // Verify cache key does not exist initially
      const initialHit = await cacheRedis.get(cacheKey);
      expect(initialHit).toBeNull();

      // 1. First read — loads from DB and stores in Redis
      const read1 = await request(app)
        .get(`/boards/${board.id}`)
        .set('Authorization', authHeader(memberUser));

      expect(read1.status).toBe(200);
      const cachedData = await cacheRedis.get(cacheKey);
      expect(cachedData).not.toBeNull();
      const parsedCache = JSON.parse(cachedData as string);
      expect(parsedCache.id).toBe(board.id);

      // 2. Second read — served directly from Redis cache
      const read2 = await request(app)
        .get(`/boards/${board.id}`)
        .set('Authorization', authHeader(memberUser));
      expect(read2.status).toBe(200);

      // 3. Mutate board by updating board name
      const updateRes = await request(app)
        .patch(`/boards/${board.id}`)
        .set('Authorization', authHeader(ownerUser))
        .send({ name: 'Renamed Cache Invalidation Board' });

      expect(updateRes.status).toBe(200);

      // 4. Verify cache was invalidated
      const cacheAfterMutation = await cacheRedis.get(cacheKey);
      expect(cacheAfterMutation).toBeNull();

      // 5. Subsequent read returns the updated board name and repopulates cache
      const read3 = await request(app)
        .get(`/boards/${board.id}`)
        .set('Authorization', authHeader(memberUser));

      expect(read3.status).toBe(200);
      expect(read3.body.data.name).toBe('Renamed Cache Invalidation Board');
    });
  });

  describe('Attachments (S3 Pre-signed Upload & Download)', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post(`/columns/${column.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Attachment Target Task' });
      taskId = res.body.data.id;
    });

    it('generates a pre-signed PUT URL for valid MIME type and size', async () => {
      const res = await request(app)
        .post(`/tasks/${taskId}/attachments/presign`)
        .set('Authorization', authHeader(memberUser))
        .send({
          fileName: 'project-specs.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024 * 1024, // 1 MB
        });

      expect(res.status).toBe(200);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.key).toMatch(new RegExp(`^workspaces/${workspace.id}/tasks/${taskId}/`));
      expect(res.body.data.expiresInSeconds).toBe(900);
    });

    it('rejects forbidden file types and oversized files', async () => {
      // Disallowed MIME type
      const res1 = await request(app)
        .post(`/tasks/${taskId}/attachments/presign`)
        .set('Authorization', authHeader(memberUser))
        .send({
          fileName: 'malware.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 1024,
        });
      expect(res1.status).toBe(400);
      expect(res1.body.error.code).toBe('INVALID_MIME_TYPE');

      // Oversized file (>10MB)
      const res2 = await request(app)
        .post(`/tasks/${taskId}/attachments/presign`)
        .set('Authorization', authHeader(memberUser))
        .send({
          fileName: 'large.zip',
          mimeType: 'application/zip',
          sizeBytes: 25 * 1024 * 1024,
        });
      expect(res2.status).toBe(400);
      expect(res2.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('confirms upload, saves Attachment row, and generates download URL', async () => {
      // 1. Presign
      const presignRes = await request(app)
        .post(`/tasks/${taskId}/attachments/presign`)
        .set('Authorization', authHeader(memberUser))
        .send({
          fileName: 'architecture.png',
          mimeType: 'image/png',
          sizeBytes: 256 * 1024,
        });
      const key = presignRes.body.data.key;

      // 2. Confirm upload
      const confirmRes = await request(app)
        .post(`/tasks/${taskId}/attachments/confirm`)
        .set('Authorization', authHeader(memberUser))
        .send({
          key,
          fileName: 'architecture.png',
          mimeType: 'image/png',
          sizeBytes: 256 * 1024,
        });

      expect(confirmRes.status).toBe(201);
      expect(confirmRes.body.data.fileName).toBe('architecture.png');
      expect(confirmRes.body.data.key).toBe(key);
      const attachmentId = confirmRes.body.data.id;

      // 3. List attachments on task
      const listRes = await request(app)
        .get(`/tasks/${taskId}/attachments`)
        .set('Authorization', authHeader(memberUser));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);

      // 4. Get pre-signed download URL
      const downloadRes = await request(app)
        .get(`/attachments/${attachmentId}/url`)
        .set('Authorization', authHeader(memberUser));
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.body.data.downloadUrl).toBeDefined();

      // 5. Delete attachment
      const deleteRes = await request(app)
        .delete(`/attachments/${attachmentId}`)
        .set('Authorization', authHeader(memberUser));
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.message).toBe('Attachment deleted successfully');
    });

    it('prevents non-workspace members from accessing attachments (IDOR)', async () => {
      const presignRes = await request(app)
        .post(`/tasks/${taskId}/attachments/presign`)
        .set('Authorization', authHeader(memberUser))
        .send({
          fileName: 'confidential.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        });
      const key = presignRes.body.data.key;

      const confirmRes = await request(app)
        .post(`/tasks/${taskId}/attachments/confirm`)
        .set('Authorization', authHeader(memberUser))
        .send({
          key,
          fileName: 'confidential.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        });
      const attachmentId = confirmRes.body.data.id;

      // Outside user tries to download attachment -> 404
      const downloadRes = await request(app)
        .get(`/attachments/${attachmentId}/url`)
        .set('Authorization', authHeader(outsideUser));
      expect(downloadRes.status).toBe(404);

      // Outside user tries to presign upload on task -> 404
      const outsidePresign = await request(app)
        .post(`/tasks/${taskId}/attachments/presign`)
        .set('Authorization', authHeader(outsideUser))
        .send({
          fileName: 'malicious.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        });
      expect(outsidePresign.status).toBe(404);
    });
  });

  describe('Transactional Outbox & BullMQ Background Workers', () => {
    it('persists OutboxEvent in the same transaction as task creation and assignment', async () => {
      const taskRes = await request(app)
        .post(`/columns/${column.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Outbox Test Task' });

      const taskId = taskRes.body.data.id;

      // Verify task.created outbox event was recorded in DB
      const createEvents = await prisma.outboxEvent.findMany({
        where: {
          aggregateId: taskId,
          type: 'task.created',
        },
      });

      expect(createEvents).toHaveLength(1);
      expect(createEvents[0]?.processedAt).toBeNull();

      // Assign member to task
      await request(app)
        .put(`/tasks/${taskId}/assignees`)
        .set('Authorization', authHeader(memberUser))
        .send({ userIds: [ownerUser.id] });

      // Verify task.assigned outbox event was recorded in DB
      const assignEvents = await prisma.outboxEvent.findMany({
        where: {
          aggregateId: taskId,
          type: 'task.assigned',
        },
      });

      expect(assignEvents).toHaveLength(1);
      expect(assignEvents[0]?.processedAt).toBeNull();

      // 2. Process outbox events via the relay
      const processedCount = await processOutboxEvents();
      expect(processedCount).toBeGreaterThanOrEqual(2);

      // Verify processedAt timestamp is now set
      const updatedEvents = await prisma.outboxEvent.findMany({
        where: { aggregateId: taskId },
      });
      for (const ev of updatedEvents) {
        expect(ev.processedAt).not.toBeNull();
      }
    });

    it('processes assignment email job via BullMQ worker without error', async () => {
      const worker = createAssignmentEmailWorker();

      // Create task and assign to ownerUser
      const taskRes = await request(app)
        .post(`/columns/${column.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'BullMQ Email Test' });
      const taskId = taskRes.body.data.id;

      await request(app)
        .put(`/tasks/${taskId}/assignees`)
        .set('Authorization', authHeader(memberUser))
        .send({ userIds: [ownerUser.id] });

      // Relay outbox to queue
      await processOutboxEvents();

      // Wait brief moment for worker to process queue
      await new Promise((resolve) => setTimeout(resolve, 800));

      await worker.close();
    });

    it('dispatches timezone-aware daily reminders for tasks due within 24 hours', async () => {
      const dueSoonDate = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now

      // Create task due in 12 hours and assign it
      const taskRes = await request(app)
        .post(`/columns/${column.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({
          title: 'Urgent Task Due Soon',
          dueDate: dueSoonDate.toISOString(),
          assigneeIds: [ownerUser.id],
        });

      expect(taskRes.status).toBe(201);

      const worker = createDueRemindersWorker();

      // Trigger dispatchDueReminders
      const count = await dispatchDueReminders();
      expect(count).toBeGreaterThanOrEqual(1);

      // Allow worker to consume reminder job
      await new Promise((resolve) => setTimeout(resolve, 800));

      await worker.close();
    });
  });
});
