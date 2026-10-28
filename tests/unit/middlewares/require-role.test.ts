import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireRole, ROLE_RANK } from '../../../src/middlewares/require-role.js';
import { prisma } from '../../../src/config/prisma.js';

vi.mock('../../../src/config/prisma.js', () => ({
  prisma: {
    workspaceMember: {
      findUnique: vi.fn(),
    },
    board: {
      findUnique: vi.fn(),
    },
    column: {
      findUnique: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
    subtask: {
      findUnique: vi.fn(),
    },
  },
}));

describe('requireRole middleware', () => {
  const res = {} as Response;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('exports correct ROLE_RANK hierarchy', () => {
    expect(ROLE_RANK.VIEWER).toBe(0);
    expect(ROLE_RANK.MEMBER).toBe(1);
    expect(ROLE_RANK.ADMIN).toBe(2);
    expect(ROLE_RANK.OWNER).toBe(3);
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.ADMIN);
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.MEMBER);
    expect(ROLE_RANK.MEMBER).toBeGreaterThan(ROLE_RANK.VIEWER);
  });

  it('throws 401 UNAUTHORIZED if req.user is missing', async () => {
    const middleware = requireRole('VIEWER');
    const req = {
      baseUrl: '/workspaces',
      params: { id: 'ws-123' },
    } as unknown as Request;

    await expect(middleware(req, res, next)).rejects.toThrow(
      expect.objectContaining({ statusCode: 401, code: 'UNAUTHORIZED' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 404 NOT_FOUND if workspaceId cannot be resolved', async () => {
    const middleware = requireRole('VIEWER');
    const req = {
      user: { id: 'user-1', email: 'test@example.com' },
      baseUrl: '/unrelated',
      params: {},
      body: {},
    } as unknown as Request;

    await expect(middleware(req, res, next)).rejects.toThrow(
      expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 404 NOT_FOUND if user is not a member of the workspace (IDOR protection)', async () => {
    const middleware = requireRole('VIEWER');
    const req = {
      user: { id: 'user-1', email: 'test@example.com' },
      baseUrl: '/workspaces',
      params: { id: 'ws-secret' },
    } as unknown as Request;

    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

    await expect(middleware(req, res, next)).rejects.toThrow(
      expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 403 FORBIDDEN if user role rank is below required rank', async () => {
    const middleware = requireRole('ADMIN');
    const req = {
      user: { id: 'user-1', email: 'test@example.com' },
      baseUrl: '/workspaces',
      params: { id: 'ws-1' },
    } as unknown as Request;

    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
      workspaceId: 'ws-1',
      userId: 'user-1',
      role: 'MEMBER',
      joinedAt: new Date(),
    });

    await expect(middleware(req, res, next)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches req.membership and req.workspaceId and calls next() when role suffices', async () => {
    const middleware = requireRole('ADMIN');
    const req = {
      user: { id: 'user-1', email: 'test@example.com' },
      baseUrl: '/workspaces',
      params: { id: 'ws-1' },
    } as unknown as Request;

    const mockMembership = {
      workspaceId: 'ws-1',
      userId: 'user-1',
      role: 'ADMIN' as const,
      joinedAt: new Date(),
    };
    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(mockMembership);

    await middleware(req, res, next);

    expect(req.membership).toEqual(mockMembership);
    expect(req.workspaceId).toBe('ws-1');
    expect(next).toHaveBeenCalled();
  });

  it('resolves workspace from boardId and allows higher role (OWNER >= ADMIN)', async () => {
    const middleware = requireRole('ADMIN');
    const req = {
      user: { id: 'user-1', email: 'test@example.com' },
      baseUrl: '/boards',
      params: { id: 'board-99' },
    } as unknown as Request;

    vi.mocked(prisma.board.findUnique).mockResolvedValue({
      id: 'board-99',
      workspaceId: 'ws-from-board',
      name: 'Sprint Board',
      createdAt: new Date(),
    });

    const mockMembership = {
      workspaceId: 'ws-from-board',
      userId: 'user-1',
      role: 'OWNER' as const,
      joinedAt: new Date(),
    };
    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(mockMembership);

    await middleware(req, res, next);

    expect(req.workspaceId).toBe('ws-from-board');
    expect(req.membership?.role).toBe('OWNER');
    expect(next).toHaveBeenCalled();
  });

  it('resolves workspace from taskId and allows member with sufficient role', async () => {
    const middleware = requireRole('MEMBER');
    const req = {
      user: { id: 'user-1', email: 'test@example.com' },
      baseUrl: '/tasks',
      params: { id: 'task-101' },
    } as unknown as Request;

    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: 'task-101',
      workspaceId: 'ws-from-task',
    } as never);

    const mockMembership = {
      workspaceId: 'ws-from-task',
      userId: 'user-1',
      role: 'MEMBER' as const,
      joinedAt: new Date(),
    };
    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(mockMembership);

    await middleware(req, res, next);

    expect(req.workspaceId).toBe('ws-from-task');
    expect(req.membership?.role).toBe('MEMBER');
    expect(next).toHaveBeenCalled();
  });
});

