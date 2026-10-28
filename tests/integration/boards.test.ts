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

describe('Boards & Columns Module Integration', () => {
  let ownerUser: { id: string; email: string };
  let adminUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };
  let outsideUser: { id: string; email: string };
  let workspace: { id: string };

  beforeEach(async () => {
    ownerUser = await createTestUser('board_owner@example.com', 'Board Owner');
    adminUser = await createTestUser('board_admin@example.com', 'Board Admin');
    memberUser = await createTestUser('board_member@example.com', 'Board Member');
    viewerUser = await createTestUser('board_viewer@example.com', 'Board Viewer');
    outsideUser = await createTestUser('board_outside@example.com', 'Board Outside');

    workspace = await createTestWorkspace(ownerUser.id, 'Board Test WS');
    await addMemberToWorkspace(workspace.id, adminUser.id, 'ADMIN');
    await addMemberToWorkspace(workspace.id, memberUser.id, 'MEMBER');
    await addMemberToWorkspace(workspace.id, viewerUser.id, 'VIEWER');
  });

  describe('POST /workspaces/:id/boards', () => {
    it('allows OWNER and ADMIN to create a board with starter columns', async () => {
      // OWNER creates board
      const res1 = await request(app)
        .post(`/workspaces/${workspace.id}/boards`)
        .set('Authorization', authHeader(ownerUser))
        .send({ name: 'Sprint 1 Board' });

      expect(res1.status).toBe(201);
      expect(res1.body.data.name).toBe('Sprint 1 Board');
      expect(res1.body.data.workspaceId).toBe(workspace.id);
      expect(res1.body.data.columns).toHaveLength(3);
      expect(res1.body.data.columns.map((c: { name: string }) => c.name)).toEqual([
        'To Do',
        'In Progress',
        'Done',
      ]);
      expect(res1.body.data.columns.map((c: { position: number }) => Number(c.position))).toEqual([
        1000,
        2000,
        3000,
      ]);

      // ADMIN creates board
      const res2 = await request(app)
        .post(`/workspaces/${workspace.id}/boards`)
        .set('Authorization', authHeader(adminUser))
        .send({ name: 'Admin Board' });

      expect(res2.status).toBe(201);
    });

    it('forbids MEMBER and VIEWER from creating boards (403)', async () => {
      for (const user of [memberUser, viewerUser]) {
        const res = await request(app)
          .post(`/workspaces/${workspace.id}/boards`)
          .set('Authorization', authHeader(user))
          .send({ name: 'Forbidden Board' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('returns 404 NOT_FOUND for non-member (IDOR check)', async () => {
      const res = await request(app)
        .post(`/workspaces/${workspace.id}/boards`)
        .set('Authorization', authHeader(outsideUser))
        .send({ name: 'Secret Board' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /workspaces/:id/boards', () => {
    beforeEach(async () => {
      await prisma.board.create({
        data: {
          workspaceId: workspace.id,
          name: 'Existing Board 1',
        },
      });
      await prisma.board.create({
        data: {
          workspaceId: workspace.id,
          name: 'Existing Board 2',
        },
      });
    });

    it('allows VIEWER, MEMBER, ADMIN, and OWNER to list boards', async () => {
      for (const user of [viewerUser, memberUser, adminUser, ownerUser]) {
        const res = await request(app)
          .get(`/workspaces/${workspace.id}/boards`)
          .set('Authorization', authHeader(user));

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('returns 404 for non-member', async () => {
      const res = await request(app)
        .get(`/workspaces/${workspace.id}/boards`)
        .set('Authorization', authHeader(outsideUser));

      expect(res.status).toBe(404);
    });
  });

  describe('GET /boards/:id', () => {
    let board: { id: string };

    beforeEach(async () => {
      const res = await request(app)
        .post(`/workspaces/${workspace.id}/boards`)
        .set('Authorization', authHeader(ownerUser))
        .send({ name: 'Detailed Board' });
      board = res.body.data;
    });

    it('allows all members of the board workspace to view board with columns', async () => {
      for (const user of [viewerUser, memberUser, adminUser, ownerUser]) {
        const res = await request(app)
          .get(`/boards/${board.id}`)
          .set('Authorization', authHeader(user));

        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(board.id);
        expect(res.body.data.columns).toHaveLength(3);
      }
    });

    it('returns 404 for non-member user accessing board (IDOR check)', async () => {
      const res = await request(app)
        .get(`/boards/${board.id}`)
        .set('Authorization', authHeader(outsideUser));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 for non-existent board ID', async () => {
      const res = await request(app)
        .get('/boards/00000000-0000-0000-0000-000000000000')
        .set('Authorization', authHeader(ownerUser));

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH & DELETE /boards/:id', () => {
    let board: { id: string };

    beforeEach(async () => {
      const res = await request(app)
        .post(`/workspaces/${workspace.id}/boards`)
        .set('Authorization', authHeader(ownerUser))
        .send({ name: 'Board to Edit' });
      board = res.body.data;
    });

    it('allows ADMIN and OWNER to update board name', async () => {
      const res1 = await request(app)
        .patch(`/boards/${board.id}`)
        .set('Authorization', authHeader(adminUser))
        .send({ name: 'Renamed by Admin' });

      expect(res1.status).toBe(200);
      expect(res1.body.data.name).toBe('Renamed by Admin');

      const res2 = await request(app)
        .patch(`/boards/${board.id}`)
        .set('Authorization', authHeader(ownerUser))
        .send({ name: 'Renamed by Owner' });

      expect(res2.status).toBe(200);
      expect(res2.body.data.name).toBe('Renamed by Owner');
    });

    it('forbids MEMBER and VIEWER from updating board (403)', async () => {
      for (const user of [memberUser, viewerUser]) {
        const res = await request(app)
          .patch(`/boards/${board.id}`)
          .set('Authorization', authHeader(user))
          .send({ name: 'Unauthorized Name' });

        expect(res.status).toBe(403);
      }
    });

    it('returns 404 for non-member attempting to patch board', async () => {
      const res = await request(app)
        .patch(`/boards/${board.id}`)
        .set('Authorization', authHeader(outsideUser))
        .send({ name: 'Infiltrated Name' });

      expect(res.status).toBe(404);
    });

    it('allows ADMIN and OWNER to delete board', async () => {
      const res = await request(app)
        .delete(`/boards/${board.id}`)
        .set('Authorization', authHeader(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Board deleted successfully');

      const exists = await prisma.board.findUnique({ where: { id: board.id } });
      expect(exists).toBeNull();
    });

    it('forbids MEMBER and VIEWER from deleting board (403)', async () => {
      for (const user of [memberUser, viewerUser]) {
        const res = await request(app)
          .delete(`/boards/${board.id}`)
          .set('Authorization', authHeader(user));

        expect(res.status).toBe(403);
      }
    });
  });

  describe('Columns CRUD & Fractional Ordering', () => {
    let board: { id: string; columns: Array<{ id: string; position: number }> };

    beforeEach(async () => {
      const res = await request(app)
        .post(`/workspaces/${workspace.id}/boards`)
        .set('Authorization', authHeader(ownerUser))
        .send({ name: 'Kanban Board' });
      board = res.body.data;
    });

    it('appends column with position = highest + 1000 when position is not specified', async () => {
      const res = await request(app)
        .post(`/boards/${board.id}/columns`)
        .set('Authorization', authHeader(adminUser))
        .send({ name: 'QA Testing' });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('QA Testing');
      // Starter positions were 1000, 2000, 3000 -> next is 4000
      expect(Number(res.body.data.position)).toBe(4000);
    });

    it('creates column with fractional position to insert between existing columns', async () => {
      // Insert between 'To Do' (1000) and 'In Progress' (2000) at 1500
      const res = await request(app)
        .post(`/boards/${board.id}/columns`)
        .set('Authorization', authHeader(ownerUser))
        .send({
          name: 'Ready for Dev',
          position: 1500,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Ready for Dev');
      expect(Number(res.body.data.position)).toBe(1500);

      // Verify ordered list
      const boardRes = await request(app)
        .get(`/boards/${board.id}`)
        .set('Authorization', authHeader(viewerUser));

      const positions = boardRes.body.data.columns.map((c: { position: number }) => Number(c.position));
      expect(positions).toEqual([1000, 1500, 2000, 3000]);
    });

    it('forbids MEMBER and VIEWER from creating columns (403)', async () => {
      for (const user of [memberUser, viewerUser]) {
        const res = await request(app)
          .post(`/boards/${board.id}/columns`)
          .set('Authorization', authHeader(user))
          .send({ name: 'Hacked Column' });

        expect(res.status).toBe(403);
      }
    });

    it('allows ADMIN and OWNER to update column name and reorder with fractional position', async () => {
      const firstColumn = board.columns[0]!;

      // Rename and move column to position 2500 (between In Progress 2000 and Done 3000)
      const res = await request(app)
        .patch(`/columns/${firstColumn.id}`)
        .set('Authorization', authHeader(adminUser))
        .send({
          name: 'Backlog (Renamed)',
          position: 2500,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Backlog (Renamed)');
      expect(Number(res.body.data.position)).toBe(2500);
    });

    it('returns 404 for non-member attempting to patch a column (cross-workspace IDOR check)', async () => {
      const firstColumn = board.columns[0]!;

      const res = await request(app)
        .patch(`/columns/${firstColumn.id}`)
        .set('Authorization', authHeader(outsideUser))
        .send({ name: 'IDOR Rename' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('allows ADMIN and OWNER to delete a column', async () => {
      const lastColumn = board.columns[2]!;

      const res = await request(app)
        .delete(`/columns/${lastColumn.id}`)
        .set('Authorization', authHeader(ownerUser));

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Column deleted successfully');

      const exists = await prisma.column.findUnique({ where: { id: lastColumn.id } });
      expect(exists).toBeNull();
    });

    it('forbids MEMBER and VIEWER from deleting a column (403)', async () => {
      const firstColumn = board.columns[0]!;

      for (const user of [memberUser, viewerUser]) {
        const res = await request(app)
          .delete(`/columns/${firstColumn.id}`)
          .set('Authorization', authHeader(user));

        expect(res.status).toBe(403);
      }
    });

    it('returns 404 for non-member attempting to delete a column', async () => {
      const firstColumn = board.columns[0]!;

      const res = await request(app)
        .delete(`/columns/${firstColumn.id}`)
        .set('Authorization', authHeader(outsideUser));

      expect(res.status).toBe(404);
    });
  });
});

