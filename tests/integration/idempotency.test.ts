import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { createTestUser, authHeader, createTestWorkspace } from '../helpers/test-utils.js';

describe('Idempotency Keys Middleware Integration (§14.1)', () => {
  let user: { id: string; email: string };
  let workspace: { id: string };
  let columnId: string;

  beforeEach(async () => {
    await prisma.idempotencyKey.deleteMany({});

    user = await createTestUser('idempotent_user@example.com', 'Idempotency User');
    workspace = await createTestWorkspace(user.id, 'Idempotency WS');

    const boardRes = await request(app)
      .post(`/workspaces/${workspace.id}/boards`)
      .set('Authorization', authHeader(user))
      .send({ name: 'Idempotent Board' });

    columnId = boardRes.body.data.columns[0].id;
  });

  it('replays identical response for repeated requests with same Idempotency-Key and payload', async () => {
    const idempotencyKey = 'c0a80101-0000-0000-0000-000000000001';
    const payload = { title: 'First Attempt Task' };

    // First request -> creates task
    const res1 = await request(app)
      .post(`/columns/${columnId}/tasks`)
      .set('Authorization', authHeader(user))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res1.status).toBe(201);
    expect(res1.body.data.title).toBe('First Attempt Task');
    const createdId = res1.body.data.id;

    // Second request with SAME key & SAME payload -> returns cached 201 response
    const res2 = await request(app)
      .post(`/columns/${columnId}/tasks`)
      .set('Authorization', authHeader(user))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res2.status).toBe(201);
    expect(res2.body.data.id).toBe(createdId);
    expect(res2.body.data.title).toBe('First Attempt Task');

    // Verify only ONE task was created in DB
    const count = await prisma.task.count({
      where: { columnId, title: 'First Attempt Task' },
    });
    expect(count).toBe(1);
  });

  it('returns 422 IDEMPOTENCY_KEY_REUSED when payload changes for existing key', async () => {
    const idempotencyKey = 'c0a80101-0000-0000-0000-000000000002';

    const res1 = await request(app)
      .post(`/columns/${columnId}/tasks`)
      .set('Authorization', authHeader(user))
      .set('Idempotency-Key', idempotencyKey)
      .send({ title: 'Original Task Title' });

    expect(res1.status).toBe(201);

    // Reusing the same key with DIFFERENT payload -> 422
    const res2 = await request(app)
      .post(`/columns/${columnId}/tasks`)
      .set('Authorization', authHeader(user))
      .set('Idempotency-Key', idempotencyKey)
      .send({ title: 'Tampered Different Payload' });

    expect(res2.status).toBe(422);
    expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('returns 409 REQUEST_IN_PROGRESS when request is currently being processed', async () => {
    const idempotencyKey = 'c0a80101-0000-0000-0000-000000000003';
    const payload = { title: 'Pending In Flight Task' };
    const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    // Simulate an in-progress request by manually creating an unresolved IdempotencyKey row
    await prisma.idempotencyKey.create({
      data: {
        userId: user.id,
        key: idempotencyKey,
        requestHash,
        responseCode: null,
      },
    });

    const res = await request(app)
      .post(`/columns/${columnId}/tasks`)
      .set('Authorization', authHeader(user))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REQUEST_IN_PROGRESS');
  });
});
