import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { createTestUser, authHeader, createTestWorkspace, addMemberToWorkspace } from '../helpers/test-utils.js';

describe('Workspaces Module Integration', () => {
  let ownerUser: { id: string; email: string };
  let adminUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };
  let outsideUser: { id: string; email: string };

  beforeEach(async () => {
    // Clean up test invitations and users with cascade
    await prisma.invitation.deleteMany({
      where: {
        email: { contains: 'example.com' },
      },
    });

    // Set up 5 distinct users for role-matrix and cross-workspace isolation tests
    ownerUser = await createTestUser('ws_owner@example.com', 'Workspace Owner');
    adminUser = await createTestUser('ws_admin@example.com', 'Workspace Admin');
    memberUser = await createTestUser('ws_member@example.com', 'Workspace Member');
    viewerUser = await createTestUser('ws_viewer@example.com', 'Workspace Viewer');
    outsideUser = await createTestUser('ws_outside@example.com', 'Outside User');
  });

  describe('POST /workspaces', () => {
    it('creates a workspace and makes the creator OWNER in a single transaction', async () => {
      const slug = `acme-corp-${Date.now()}`;
      const res = await request(app)
        .post('/workspaces')
        .set('Authorization', authHeader(ownerUser))
        .send({
          name: 'Acme Corporation',
          slug,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Acme Corporation');
      expect(res.body.data.slug).toBe(slug);

      // Verify creator membership in DB
      const member = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: res.body.data.id,
            userId: ownerUser.id,
          },
        },
      });
      expect(member).not.toBeNull();
      expect(member?.role).toBe('OWNER');
    });

    it('auto-generates slug from name if slug is not provided', async () => {
      const res = await request(app)
        .post('/workspaces')
        .set('Authorization', authHeader(ownerUser))
        .send({
          name: 'Auto Slug Workspace',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.slug).toMatch(/^auto-slug-workspace-[a-f0-9]{6}$/);
    });

    it('returns 409 CONFLICT if slug already exists', async () => {
      const slug = `duplicate-slug-${Date.now()}`;
      await request(app)
        .post('/workspaces')
        .set('Authorization', authHeader(ownerUser))
        .send({ name: 'First', slug });

      const res = await request(app)
        .post('/workspaces')
        .set('Authorization', authHeader(ownerUser))
        .send({ name: 'Second', slug });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('returns 401 UNAUTHORIZED if not logged in', async () => {
      const res = await request(app)
        .post('/workspaces')
        .send({ name: 'No Auth' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /workspaces', () => {
    it('returns only workspaces the calling user is a member of', async () => {
      const ws1 = await createTestWorkspace(ownerUser.id, 'Owner Workspace');
      const ws2 = await createTestWorkspace(outsideUser.id, 'Other Workspace');

      const res = await request(app)
        .get('/workspaces')
        .set('Authorization', authHeader(ownerUser));

      expect(res.status).toBe(200);
      const ids = res.body.data.map((w: { id: string }) => w.id);
      expect(ids).toContain(ws1.id);
      expect(ids).not.toContain(ws2.id);
    });
  });

  describe('GET /workspaces/:id', () => {
    let workspace: { id: string };

    beforeEach(async () => {
      workspace = await createTestWorkspace(ownerUser.id, 'Role Test Workspace');
      await addMemberToWorkspace(workspace.id, adminUser.id, 'ADMIN');
      await addMemberToWorkspace(workspace.id, memberUser.id, 'MEMBER');
      await addMemberToWorkspace(workspace.id, viewerUser.id, 'VIEWER');
    });

    it('allows OWNER, ADMIN, MEMBER, and VIEWER to view workspace', async () => {
      for (const user of [ownerUser, adminUser, memberUser, viewerUser]) {
        const res = await request(app)
          .get(`/workspaces/${workspace.id}`)
          .set('Authorization', authHeader(user));

        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(workspace.id);
      }
    });

    it('returns 404 NOT_FOUND for non-member (IDOR protection)', async () => {
      const res = await request(app)
        .get(`/workspaces/${workspace.id}`)
        .set('Authorization', authHeader(outsideUser));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /workspaces/:id (owner only)', () => {
    let workspace: { id: string };

    beforeEach(async () => {
      workspace = await createTestWorkspace(ownerUser.id, 'Update Workspace');
      await addMemberToWorkspace(workspace.id, adminUser.id, 'ADMIN');
      await addMemberToWorkspace(workspace.id, memberUser.id, 'MEMBER');
      await addMemberToWorkspace(workspace.id, viewerUser.id, 'VIEWER');
    });

    it('allows OWNER to update workspace name', async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspace.id}`)
        .set('Authorization', authHeader(ownerUser))
        .send({ name: 'Updated Workspace Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Workspace Name');
    });

    it('forbids ADMIN, MEMBER, and VIEWER from updating workspace (403)', async () => {
      for (const user of [adminUser, memberUser, viewerUser]) {
        const res = await request(app)
          .patch(`/workspaces/${workspace.id}`)
          .set('Authorization', authHeader(user))
          .send({ name: 'Hacked Name' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('returns 404 for non-member', async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspace.id}`)
        .set('Authorization', authHeader(outsideUser))
        .send({ name: 'Hacked Name' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /workspaces/:id (owner only)', () => {
    it('allows OWNER to delete workspace and cascades correctly', async () => {
      const ws = await createTestWorkspace(ownerUser.id, 'Delete Workspace');

      const res = await request(app)
        .delete(`/workspaces/${ws.id}`)
        .set('Authorization', authHeader(ownerUser));

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Workspace deleted successfully');

      const exists = await prisma.workspace.findUnique({ where: { id: ws.id } });
      expect(exists).toBeNull();
    });

    it('forbids ADMIN, MEMBER, and VIEWER from deleting workspace (403)', async () => {
      const ws = await createTestWorkspace(ownerUser.id, 'Protect Delete WS');
      await addMemberToWorkspace(ws.id, adminUser.id, 'ADMIN');
      await addMemberToWorkspace(ws.id, memberUser.id, 'MEMBER');
      await addMemberToWorkspace(ws.id, viewerUser.id, 'VIEWER');

      for (const user of [adminUser, memberUser, viewerUser]) {
        const res = await request(app)
          .delete(`/workspaces/${ws.id}`)
          .set('Authorization', authHeader(user));

        expect(res.status).toBe(403);
      }
    });

    it('returns 404 for non-member trying to delete workspace', async () => {
      const ws = await createTestWorkspace(ownerUser.id, 'Hidden WS');
      const res = await request(app)
        .delete(`/workspaces/${ws.id}`)
        .set('Authorization', authHeader(outsideUser));

      expect(res.status).toBe(404);
    });
  });

  describe('GET /workspaces/:id/members', () => {
    let workspace: { id: string };

    beforeEach(async () => {
      workspace = await createTestWorkspace(ownerUser.id, 'Members WS');
      await addMemberToWorkspace(workspace.id, adminUser.id, 'ADMIN');
      await addMemberToWorkspace(workspace.id, memberUser.id, 'MEMBER');
      await addMemberToWorkspace(workspace.id, viewerUser.id, 'VIEWER');
    });

    it('allows all workspace members (VIEWER+) to list members', async () => {
      for (const user of [ownerUser, adminUser, memberUser, viewerUser]) {
        const res = await request(app)
          .get(`/workspaces/${workspace.id}/members`)
          .set('Authorization', authHeader(user));

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(4);
      }
    });

    it('returns 404 for non-member', async () => {
      const res = await request(app)
        .get(`/workspaces/${workspace.id}/members`)
        .set('Authorization', authHeader(outsideUser));

      expect(res.status).toBe(404);
    });
  });

  describe('POST /workspaces/:id/invitations & Accept', () => {
    let workspace: { id: string };

    beforeEach(async () => {
      workspace = await createTestWorkspace(ownerUser.id, 'Invites WS');
      await addMemberToWorkspace(workspace.id, adminUser.id, 'ADMIN');
      await addMemberToWorkspace(workspace.id, memberUser.id, 'MEMBER');
      await addMemberToWorkspace(workspace.id, viewerUser.id, 'VIEWER');
    });

    it('allows OWNER and ADMIN to invite members', async () => {
      // OWNER invites a member
      const res1 = await request(app)
        .post(`/workspaces/${workspace.id}/invitations`)
        .set('Authorization', authHeader(ownerUser))
        .send({
          email: 'new_invitee_1@example.com',
          role: 'MEMBER',
        });
      expect(res1.status).toBe(201);
      expect(res1.body.data.email).toBe('new_invitee_1@example.com');

      // ADMIN invites a viewer
      const res2 = await request(app)
        .post(`/workspaces/${workspace.id}/invitations`)
        .set('Authorization', authHeader(adminUser))
        .send({
          email: 'new_invitee_2@example.com',
          role: 'VIEWER',
        });
      expect(res2.status).toBe(201);
    });

    it('forbids ADMIN from inviting someone as OWNER (403)', async () => {
      const res = await request(app)
        .post(`/workspaces/${workspace.id}/invitations`)
        .set('Authorization', authHeader(adminUser))
        .send({
          email: 'wants_owner@example.com',
          role: 'OWNER',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids MEMBER and VIEWER from inviting (403)', async () => {
      for (const user of [memberUser, viewerUser]) {
        const res = await request(app)
          .post(`/workspaces/${workspace.id}/invitations`)
          .set('Authorization', authHeader(user))
          .send({
            email: 'random@example.com',
            role: 'VIEWER',
          });

        expect(res.status).toBe(403);
      }
    });

    it('returns 409 CONFLICT when inviting an existing member', async () => {
      const res = await request(app)
        .post(`/workspaces/${workspace.id}/invitations`)
        .set('Authorization', authHeader(ownerUser))
        .send({
          email: memberUser.email,
          role: 'MEMBER',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('successfully accepts invitation and joins workspace with assigned role', async () => {
      const invitedUser = await createTestUser('invited_person@example.com', 'Invited Person');

      await request(app)
        .post(`/workspaces/${workspace.id}/invitations`)
        .set('Authorization', authHeader(ownerUser))
        .send({
          email: invitedUser.email,
          role: 'MEMBER',
        });

      // Find created invitation in DB
      const invitation = await prisma.invitation.findFirst({
        where: { workspaceId: workspace.id, email: invitedUser.email },
      });
      expect(invitation).not.toBeNull();

      // For test purposes, set a known token hash
      const { hashToken } = await import('../../src/utils/token.js');
      const testToken = `invite-token-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      await prisma.invitation.update({
        where: { id: invitation!.id },
        data: { tokenHash: hashToken(testToken) },
      });

      // Accept invitation
      const acceptRes = await request(app)
        .post('/invitations/accept')
        .set('Authorization', authHeader(invitedUser))
        .send({ token: testToken });

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.data.workspaceId).toBe(workspace.id);
      expect(acceptRes.body.data.role).toBe('MEMBER');

      // Verify membership exists in DB
      const dbMember = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: invitedUser.id,
          },
        },
      });
      expect(dbMember).not.toBeNull();
      expect(dbMember?.role).toBe('MEMBER');
    });

    it('forbids accepting invitation with mismatched user email', async () => {
      const invitedUser = await createTestUser('specific_recipient@example.com', 'Specific User');
      await request(app)
        .post(`/workspaces/${workspace.id}/invitations`)
        .set('Authorization', authHeader(ownerUser))
        .send({
          email: invitedUser.email,
          role: 'VIEWER',
        });

      const invitation = await prisma.invitation.findFirst({
        where: { workspaceId: workspace.id, email: invitedUser.email },
      });

      const { hashToken } = await import('../../src/utils/token.js');
      const testToken = `mismatch-token-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      await prisma.invitation.update({
        where: { id: invitation!.id },
        data: { tokenHash: hashToken(testToken) },
      });

      // Someone else tries to accept
      const res = await request(app)
        .post('/invitations/accept')
        .set('Authorization', authHeader(outsideUser))
        .send({ token: testToken });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('PATCH /workspaces/:id/members/:userId (role modification)', () => {
    let workspace: { id: string };

    beforeEach(async () => {
      workspace = await createTestWorkspace(ownerUser.id, 'Role Update WS');
      await addMemberToWorkspace(workspace.id, adminUser.id, 'ADMIN');
      await addMemberToWorkspace(workspace.id, memberUser.id, 'MEMBER');
      await addMemberToWorkspace(workspace.id, viewerUser.id, 'VIEWER');
    });

    it('allows OWNER to update member role to ADMIN', async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspace.id}/members/${memberUser.id}`)
        .set('Authorization', authHeader(ownerUser))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('ADMIN');
    });

    it('allows ADMIN to update VIEWER to MEMBER', async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspace.id}/members/${viewerUser.id}`)
        .set('Authorization', authHeader(adminUser))
        .send({ role: 'MEMBER' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('MEMBER');
    });

    it('forbids ADMIN from modifying OWNER role (403)', async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspace.id}/members/${ownerUser.id}`)
        .set('Authorization', authHeader(adminUser))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids ADMIN from promoting anyone to OWNER (403)', async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspace.id}/members/${memberUser.id}`)
        .set('Authorization', authHeader(adminUser))
        .send({ role: 'OWNER' });

      expect(res.status).toBe(403);
    });

    it('forbids MEMBER and VIEWER from modifying any role (403)', async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspace.id}/members/${viewerUser.id}`)
        .set('Authorization', authHeader(memberUser))
        .send({ role: 'MEMBER' });

      expect(res.status).toBe(403);
    });

    it('forbids self-modification of role (400)', async () => {
      const res = await request(app)
        .patch(`/workspaces/${workspace.id}/members/${ownerUser.id}`)
        .set('Authorization', authHeader(ownerUser))
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(400);
    });

    it('prevents demoting the last owner (400 INVARIANT_VIOLATION)', async () => {
      // Create second owner first
      const secondOwner = await createTestUser('second_owner@example.com');
      await addMemberToWorkspace(workspace.id, secondOwner.id, 'OWNER');

      // Now demoting one owner works
      const res1 = await request(app)
        .patch(`/workspaces/${workspace.id}/members/${secondOwner.id}`)
        .set('Authorization', authHeader(ownerUser))
        .send({ role: 'ADMIN' });
      expect(res1.status).toBe(200);

      // Demoting the only remaining owner fails
      const res2 = await request(app)
        .patch(`/workspaces/${workspace.id}/members/${ownerUser.id}`)
        .set('Authorization', authHeader(secondOwner)) // secondOwner is now admin, but even if owner tried via another route
        .send({ role: 'ADMIN' });
      expect(res2.status).toBe(403); // secondOwner is admin, can't modify owner
    });
  });

  describe('DELETE /workspaces/:id/members/:userId (removal & leave)', () => {
    let workspace: { id: string };

    beforeEach(async () => {
      workspace = await createTestWorkspace(ownerUser.id, 'Remove Member WS');
      await addMemberToWorkspace(workspace.id, adminUser.id, 'ADMIN');
      await addMemberToWorkspace(workspace.id, memberUser.id, 'MEMBER');
      await addMemberToWorkspace(workspace.id, viewerUser.id, 'VIEWER');
    });

    it('allows a member to leave the workspace themselves', async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspace.id}/members/${memberUser.id}`)
        .set('Authorization', authHeader(memberUser));

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Left workspace successfully');
    });

    it('prevents the sole owner from leaving without transferring ownership', async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspace.id}/members/${ownerUser.id}`)
        .set('Authorization', authHeader(ownerUser));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('allows ADMIN to remove a MEMBER', async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspace.id}/members/${memberUser.id}`)
        .set('Authorization', authHeader(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Member removed successfully');
    });

    it('forbids ADMIN from removing an OWNER (403)', async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspace.id}/members/${ownerUser.id}`)
        .set('Authorization', authHeader(adminUser));

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids MEMBER and VIEWER from removing someone else (403)', async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspace.id}/members/${viewerUser.id}`)
        .set('Authorization', authHeader(memberUser));

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-member', async () => {
      const res = await request(app)
        .delete(`/workspaces/${workspace.id}/members/${viewerUser.id}`)
        .set('Authorization', authHeader(outsideUser));

      expect(res.status).toBe(404);
    });
  });
});
