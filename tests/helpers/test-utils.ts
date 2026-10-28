import { prisma } from '../../src/config/prisma.js';
import { signAccessToken } from '../../src/utils/token.js';
import type { Role } from '../../src/generated/prisma/client.js';

export async function createTestUser(email: string, name = 'Test User') {
  return prisma.user.upsert({
    where: { email },
    update: { emailVerified: true },
    create: {
      email,
      name,
      emailVerified: true,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashforunittests',
    },
  });
}

export function authHeader(user: { id: string; email: string }): string {
  const token = signAccessToken({ sub: user.id, email: user.email });
  return `Bearer ${token}`;
}

export async function createTestWorkspace(ownerId: string, name = 'Test Workspace', slug?: string) {
  const uniqueSlug = slug || `ws-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  return prisma.workspace.create({
    data: {
      name,
      slug: uniqueSlug,
      members: {
        create: {
          userId: ownerId,
          role: 'OWNER',
        },
      },
    },
    include: {
      members: true,
    },
  });
}

export async function addMemberToWorkspace(workspaceId: string, userId: string, role: Role) {
  return prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId,
      role,
    },
  });
}

