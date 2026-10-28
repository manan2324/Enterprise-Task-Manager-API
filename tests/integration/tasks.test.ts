import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import {
  createTestUser,
  authHeader,
  createTestWorkspace,
  addMemberToWorkspace,
} from '../helpers/test-utils.js';

describe('Tasks, Subtasks, Comments & Activity Log Integration', () => {
  let ownerUser: { id: string; email: string };
  let adminUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };
  let outsideUser: { id: string; email: string };
  let workspace: { id: string };
  let board: { id: string };
  let column1: { id: string };
  let column2: { id: string };

  beforeEach(async () => {
    // Clean up previous test activity logs, tasks, and users
    await prisma.activityLog.deleteMany({
      where: {
        workspace: {
          name: { contains: 'Task Test' },
        },
      },
    });

    ownerUser = await createTestUser('task_owner@example.com', 'Task Owner');
    adminUser = await createTestUser('task_admin@example.com', 'Task Admin');
    memberUser = await createTestUser('task_member@example.com', 'Task Member');
    viewerUser = await createTestUser('task_viewer@example.com', 'Task Viewer');
    outsideUser = await createTestUser('task_outside@example.com', 'Task Outside');

    workspace = await createTestWorkspace(ownerUser.id, 'Task Test WS');
    await addMemberToWorkspace(workspace.id, adminUser.id, 'ADMIN');
    await addMemberToWorkspace(workspace.id, memberUser.id, 'MEMBER');
    await addMemberToWorkspace(workspace.id, viewerUser.id, 'VIEWER');

    // Create a board with starter columns
    const boardRes = await request(app)
      .post(`/workspaces/${workspace.id}/boards`)
      .set('Authorization', authHeader(ownerUser))
      .send({ name: 'Development Board' });

    board = boardRes.body.data;
    column1 = boardRes.body.data.columns[0];
    column2 = boardRes.body.data.columns[1];
  });

  describe('POST /columns/:id/tasks (Task Creation & Activity Log)', () => {
    it('creates a task with fractional position and logs task.created in the same transaction', async () => {
      const res = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({
          title: 'Implement Authentication',
          description: 'Add JWT tokens and refresh rotation',
          status: 'TODO',
          priority: 'HIGH',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('Implement Authentication');
      expect(Number(res.body.data.position)).toBe(1000);
      expect(res.body.data.version).toBe(1);

      const taskId = res.body.data.id;

      // Verify ActivityLog was created inside the same transaction
      const logs = await prisma.activityLog.findMany({
        where: {
          workspaceId: workspace.id,
          entityType: 'task',
          entityId: taskId,
        },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0]?.action).toBe('task.created');
      expect(logs[0]?.actorId).toBe(memberUser.id);
    });

    it('assigns auto-incrementing fractional positions for subsequent tasks in column', async () => {
      const res1 = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Task 1' });

      const res2 = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Task 2' });

      expect(Number(res1.body.data.position)).toBe(1000);
      expect(Number(res2.body.data.position)).toBe(2000);
    });

    it('forbids VIEWER from creating tasks (403)', async () => {
      const res = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(viewerUser))
        .send({ title: 'Viewer Task' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 for non-member (cross-workspace IDOR check)', async () => {
      const res = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(outsideUser))
        .send({ title: 'Infiltrated Task' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects assignees that are not members of the workspace (400)', async () => {
      const res = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({
          title: 'Invalid Assignee Task',
          assigneeIds: [outsideUser.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('GET /tasks/:id (Task Details)', () => {
    it('allows VIEWER+ to retrieve full task details', async () => {
      const createRes = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Detailed Task' });
      const taskId = createRes.body.data.id;

      for (const user of [viewerUser, memberUser, adminUser, ownerUser]) {
        const res = await request(app)
          .get(`/tasks/${taskId}`)
          .set('Authorization', authHeader(user));

        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(taskId);
        expect(res.body.data.column.id).toBe(column1.id);
      }
    });

    it('returns 404 for non-member', async () => {
      const createRes = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Private Task' });

      const res = await request(app)
        .get(`/tasks/${createRes.body.data.id}`)
        .set('Authorization', authHeader(outsideUser));

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /tasks/:id (Optimistic Concurrency with Version Field)', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Original Task', status: 'TODO', priority: 'LOW' });
      taskId = res.body.data.id;
    });

    it('updates task and increments version on success', async () => {
      const res = await request(app)
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(memberUser))
        .send({
          title: 'Updated Task Title',
          status: 'IN_PROGRESS',
          version: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe('Updated Task Title');
      expect(res.body.data.status).toBe('IN_PROGRESS');
      expect(res.body.data.version).toBe(2);

      // Verify diff logged in activity table
      const logs = await prisma.activityLog.findMany({
        where: { entityId: taskId, action: 'task.updated' },
      });
      expect(logs).toHaveLength(1);
      const meta = logs[0]?.metadata as Record<string, { from: unknown; to: unknown }>;
      expect(meta['title']).toEqual({ from: 'Original Task', to: 'Updated Task Title' });
      expect(meta['status']).toEqual({ from: 'TODO', to: 'IN_PROGRESS' });
    });

    it('supports If-Match header for optimistic concurrency', async () => {
      const res = await request(app)
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(memberUser))
        .set('If-Match', '"1"')
        .send({ title: 'Updated Via Header' });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 VERSION_CONFLICT when client provides stale version', async () => {
      // First update brings version to 2
      await request(app)
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'First Update', version: 1 });

      // Second update still uses version 1 (simulating concurrent edit collision)
      const res = await request(app)
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Concurrent Conflicting Update', version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
      expect(res.body.error.details.currentVersion).toBe(2);
    });

    it('forbids VIEWER from updating tasks (403)', async () => {
      const res = await request(app)
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(viewerUser))
        .send({ title: 'Hacked by Viewer' });

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /tasks/:id/move (Fractional Positioning)', () => {
    let task1Id: string;
    let task2Id: string;
    let taskToMoveId: string;

    beforeEach(async () => {
      // Create two tasks in column2 with positions 1000 and 2000
      const t1 = await request(app)
        .post(`/columns/${column2.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Task in Col 2 (First)' });
      task1Id = t1.body.data.id;

      const t2 = await request(app)
        .post(`/columns/${column2.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Task in Col 2 (Second)' });
      task2Id = t2.body.data.id;

      // Task in column1 that will be moved
      const tMove = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Task to Move' });
      taskToMoveId = tMove.body.data.id;
    });

    it('moves task between two existing tasks and calculates midpoint position', async () => {
      // Insert between task1 (1000) and task2 (2000) -> expected 1500
      const res = await request(app)
        .patch(`/tasks/${taskToMoveId}/move`)
        .set('Authorization', authHeader(memberUser))
        .send({
          columnId: column2.id,
          beforeTaskId: task1Id,
          afterTaskId: task2Id,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.columnId).toBe(column2.id);
      expect(Number(res.body.data.position)).toBe(1500);

      // Verify activity log recorded
      const logs = await prisma.activityLog.findMany({
        where: { entityId: taskToMoveId, action: 'task.moved' },
      });
      expect(logs).toHaveLength(1);
    });

    it('moves task to head of column before first task', async () => {
      // Insert before task1 (1000) -> expected 500
      const res = await request(app)
        .patch(`/tasks/${taskToMoveId}/move`)
        .set('Authorization', authHeader(memberUser))
        .send({
          columnId: column2.id,
          afterTaskId: task1Id,
        });

      expect(res.status).toBe(200);
      expect(Number(res.body.data.position)).toBe(500);
    });

    it('prevents moving task to a column in another workspace (400)', async () => {
      const foreignWorkspace = await createTestWorkspace(outsideUser.id, 'Foreign Workspace');
      const foreignBoardRes = await request(app)
        .post(`/workspaces/${foreignWorkspace.id}/boards`)
        .set('Authorization', authHeader(outsideUser))
        .send({ name: 'Foreign Board' });
      const foreignColId = foreignBoardRes.body.data.columns[0].id;

      const res = await request(app)
        .patch(`/tasks/${taskToMoveId}/move`)
        .set('Authorization', authHeader(memberUser))
        .send({ columnId: foreignColId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('DELETE /tasks/:id (Soft Deletion)', () => {
    it('soft-deletes task and records task.deleted in activity log', async () => {
      const taskRes = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Task to Delete' });
      const taskId = taskRes.body.data.id;

      const deleteRes = await request(app)
        .delete(`/tasks/${taskId}`)
        .set('Authorization', authHeader(memberUser));

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.message).toBe('Task deleted successfully');

      // Verify task is soft deleted (not found on regular fetch)
      const getRes = await request(app)
        .get(`/tasks/${taskId}`)
        .set('Authorization', authHeader(memberUser));
      expect(getRes.status).toBe(404);

      // Verify row in DB has deletedAt set
      const dbTask = await prisma.task.findUnique({ where: { id: taskId } });
      expect(dbTask?.deletedAt).not.toBeNull();

      // Verify activity log recorded
      const logs = await prisma.activityLog.findMany({
        where: { entityId: taskId, action: 'task.deleted' },
      });
      expect(logs).toHaveLength(1);
    });
  });

  describe('PUT /tasks/:id/assignees & /tags', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Assignment Task' });
      taskId = res.body.data.id;
    });

    it('assigns workspace members to task and logs task.assigned', async () => {
      const res = await request(app)
        .put(`/tasks/${taskId}/assignees`)
        .set('Authorization', authHeader(memberUser))
        .send({ userIds: [adminUser.id, memberUser.id] });

      expect(res.status).toBe(200);
      const assigneeIds = res.body.data.assignees.map((a: { user: { id: string } }) => a.user.id);
      expect(assigneeIds).toContain(adminUser.id);
      expect(assigneeIds).toContain(memberUser.id);

      const logs = await prisma.activityLog.findMany({
        where: { entityId: taskId, action: 'task.assigned' },
      });
      expect(logs).toHaveLength(1);
    });

    it('attaches workspace tags to task and logs task.tagged', async () => {
      // Create tags first
      const tag1Res = await request(app)
        .post(`/workspaces/${workspace.id}/tags`)
        .set('Authorization', authHeader(memberUser))
        .send({ name: 'Backend', color: '#3b82f6' });
      const tag1 = tag1Res.body.data;

      const tag2Res = await request(app)
        .post(`/workspaces/${workspace.id}/tags`)
        .set('Authorization', authHeader(memberUser))
        .send({ name: 'Urgent', color: '#ef4444' });
      const tag2 = tag2Res.body.data;

      const res = await request(app)
        .put(`/tasks/${taskId}/tags`)
        .set('Authorization', authHeader(memberUser))
        .send({ tagIds: [tag1.id, tag2.id] });

      expect(res.status).toBe(200);
      const attachedTagIds = res.body.data.tags.map((t: { tag: { id: string } }) => t.tag.id);
      expect(attachedTagIds).toContain(tag1.id);
      expect(attachedTagIds).toContain(tag2.id);

      const logs = await prisma.activityLog.findMany({
        where: { entityId: taskId, action: 'task.tagged' },
      });
      expect(logs).toHaveLength(1);

      // List tags endpoint
      const listTagsRes = await request(app)
        .get(`/workspaces/${workspace.id}/tags`)
        .set('Authorization', authHeader(viewerUser));
      expect(listTagsRes.status).toBe(200);
      expect(listTagsRes.body.data.length).toBeGreaterThanOrEqual(2);

      // Duplicate tag name returns 409
      const dupTagRes = await request(app)
        .post(`/workspaces/${workspace.id}/tags`)
        .set('Authorization', authHeader(memberUser))
        .send({ name: 'Backend', color: '#10b981' });
      expect(dupTagRes.status).toBe(409);
      expect(dupTagRes.body.error.code).toBe('CONFLICT');

      // Attaching foreign tag returns 400
      const foreignWorkspace = await createTestWorkspace(outsideUser.id, 'Other Tag WS');
      const foreignTagRes = await request(app)
        .post(`/workspaces/${foreignWorkspace.id}/tags`)
        .set('Authorization', authHeader(outsideUser))
        .send({ name: 'ForeignTag', color: '#000000' });
      const foreignTagId = foreignTagRes.body.data.id;

      const foreignAttachRes = await request(app)
        .put(`/tasks/${taskId}/tags`)
        .set('Authorization', authHeader(memberUser))
        .send({ tagIds: [foreignTagId] });
      expect(foreignAttachRes.status).toBe(400);
      expect(foreignAttachRes.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('Subtasks CRUD', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Task with Subtasks' });
      taskId = res.body.data.id;
    });

    it('creates, updates, and deletes subtasks', async () => {
      // 1. Create subtask
      const createRes = await request(app)
        .post(`/tasks/${taskId}/subtasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Subtask Checklist 1' });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.title).toBe('Subtask Checklist 1');
      expect(createRes.body.data.done).toBe(false);
      const subtaskId = createRes.body.data.id;

      // 2. Update subtask (toggle done)
      const updateRes = await request(app)
        .patch(`/tasks/${taskId}/subtasks/${subtaskId}`)
        .set('Authorization', authHeader(memberUser))
        .send({ done: true });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.done).toBe(true);

      // 3. Delete subtask
      const deleteRes = await request(app)
        .delete(`/tasks/${taskId}/subtasks/${subtaskId}`)
        .set('Authorization', authHeader(memberUser));

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.message).toBe('Subtask deleted successfully');
    });
  });

  describe('Comments & Activity Feeds', () => {
    let taskId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Task for Discussion' });
      taskId = res.body.data.id;
    });

    it('adds comments and lists comments for a task', async () => {
      const addRes = await request(app)
        .post(`/tasks/${taskId}/comments`)
        .set('Authorization', authHeader(memberUser))
        .send({ body: 'Working on this feature today!' });

      expect(addRes.status).toBe(201);
      expect(addRes.body.data.body).toBe('Working on this feature today!');
      expect(addRes.body.data.author.id).toBe(memberUser.id);

      const listRes = await request(app)
        .get(`/tasks/${taskId}/comments`)
        .set('Authorization', authHeader(viewerUser));

      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);
    });

    it('retrieves activity logs for a task and a board', async () => {
      await request(app)
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Renamed Task Title' });

      // Task activity
      const taskActRes = await request(app)
        .get(`/tasks/${taskId}/activity`)
        .set('Authorization', authHeader(viewerUser));

      expect(taskActRes.status).toBe(200);
      expect(taskActRes.body.data.length).toBeGreaterThanOrEqual(2); // created + updated

      // Board activity
      const boardActRes = await request(app)
        .get(`/boards/${board.id}/activity`)
        .set('Authorization', authHeader(viewerUser));

      expect(boardActRes.status).toBe(200);
      expect(boardActRes.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Transaction Atomicity Proof (Rollback Test)', () => {
    it('proves no activity row exists when a transaction rolls back', async () => {
      // 1. Create a base task
      const taskRes = await request(app)
        .post(`/columns/${column1.id}/tasks`)
        .set('Authorization', authHeader(memberUser))
        .send({ title: 'Base Task for Rollback Test' });

      const taskId = taskRes.body.data.id;

      // Count existing activity logs for this task (should be 1 for task.created)
      const countBefore = await prisma.activityLog.count({
        where: { entityId: taskId },
      });
      expect(countBefore).toBe(1);

      // 2. Execute a transaction where an activity log is staged, but a subsequent error forces rollback
      let txErrorOccurred = false;
      try {
        await prisma.$transaction(async (tx) => {
          // Stage a task update and record activity log inside tx
          await tx.task.update({
            where: { id: taskId },
            data: { title: 'Temporary Title in Failing Tx' },
          });

          await tx.activityLog.create({
            data: {
              workspaceId: workspace.id,
              actorId: memberUser.id,
              entityType: 'task',
              entityId: taskId,
              action: 'task.simulated_failure_action',
              metadata: { attempt: 'will rollback' },
            },
          });

          // Force an intentional rollback by throwing an error before commit
          throw new Error('SIMULATED_TRANSACTION_FAILURE');
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'SIMULATED_TRANSACTION_FAILURE') {
          txErrorOccurred = true;
        }
      }

      expect(txErrorOccurred).toBe(true);

      // 3. PROVE THAT NO ACTIVITY ROW WAS PERSISTED for the failed transaction
      const failingLogs = await prisma.activityLog.findMany({
        where: {
          entityId: taskId,
          action: 'task.simulated_failure_action',
        },
      });
      expect(failingLogs).toHaveLength(0);

      // And task title was NOT changed
      const taskAfter = await prisma.task.findUnique({ where: { id: taskId } });
      expect(taskAfter?.title).toBe('Base Task for Rollback Test');

      // Total activity logs remain identical to countBefore
      const countAfter = await prisma.activityLog.count({
        where: { entityId: taskId },
      });
      expect(countAfter).toBe(countBefore);
    });
  });
});
