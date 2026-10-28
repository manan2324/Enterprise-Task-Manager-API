import { prisma } from '../../config/prisma.js';
import type { Role, Workspace, WorkspaceMember, Invitation } from '../../generated/prisma/client.js';

export class WorkspacesRepository {
  async createWorkspaceWithMember(data: {
    name: string;
    slug: string;
    ownerId: string;
  }): Promise<Workspace & { members: WorkspaceMember[] }> {
    return prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: data.name,
          slug: data.slug,
          members: {
            create: {
              userId: data.ownerId,
              role: 'OWNER',
            },
          },
        },
        include: {
          members: true,
        },
      });

      return workspace;
    });
  }

  async findUserWorkspaces(userId: string) {
    return prisma.workspace.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      include: {
        members: {
          where: { userId },
          select: { role: true, joinedAt: true },
        },
        _count: {
          select: { members: true, boards: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findWorkspaceById(id: string): Promise<Workspace | null> {
    return prisma.workspace.findUnique({
      where: { id },
    });
  }

  async findWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    return prisma.workspace.findUnique({
      where: { slug },
    });
  }

  async updateWorkspace(id: string, data: { name?: string; slug?: string }): Promise<Workspace> {
    return prisma.workspace.update({
      where: { id },
      data,
    });
  }

  async deleteWorkspace(id: string): Promise<void> {
    await prisma.workspace.delete({
      where: { id },
    });
  }

  async findMembers(workspaceId: string) {
    return prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async findMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    return prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });
  }

  async countOwners(workspaceId: string): Promise<number> {
    return prisma.workspaceMember.count({
      where: {
        workspaceId,
        role: 'OWNER',
      },
    });
  }

  async updateMemberRole(workspaceId: string, userId: string, role: Role): Promise<WorkspaceMember> {
    return prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
      data: { role },
    });
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });
  }

  async createInvitation(data: {
    workspaceId: string;
    email: string;
    role: Role;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<Invitation> {
    return prisma.invitation.create({
      data,
    });
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<(Invitation & { workspace: Workspace }) | null> {
    return prisma.invitation.findUnique({
      where: { tokenHash },
      include: { workspace: true },
    });
  }

  async findPendingInvitations(workspaceId: string): Promise<Invitation[]> {
    return prisma.invitation.findMany({
      where: {
        workspaceId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async acceptInvitation(
    invitationId: string,
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<WorkspaceMember> {
    return prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitationId },
        data: { acceptedAt: new Date() },
      });

      const member = await tx.workspaceMember.create({
        data: {
          workspaceId,
          userId,
          role,
        },
      });

      return member;
    });
  }
}

export const workspacesRepository = new WorkspacesRepository();

