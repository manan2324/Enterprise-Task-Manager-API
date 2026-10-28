import crypto from 'node:crypto';
import { workspacesRepository, type WorkspacesRepository } from './workspaces.repository.js';
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  InviteMemberInput,
  UpdateMemberRoleInput,
} from './workspaces.schemas.ts';
import { AppError } from '../../utils/app-error.js';
import { hashToken, generateRandomToken } from '../../utils/token.js';
import { emailService } from '../../services/email.service.js';
import type { Role } from '../../generated/prisma/client.js';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const randomSuffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'workspace'}-${randomSuffix}`;
}

export class WorkspacesService {
  constructor(private repo: WorkspacesRepository = workspacesRepository) {}

  async createWorkspace(userId: string, input: CreateWorkspaceInput) {
    let slug = input.slug;
    if (!slug) {
      slug = slugify(input.name);
    } else {
      const existing = await this.repo.findWorkspaceBySlug(slug);
      if (existing) {
        throw new AppError(409, 'CONFLICT', 'Workspace slug already taken');
      }
    }

    const workspace = await this.repo.createWorkspaceWithMember({
      name: input.name,
      slug,
      ownerId: userId,
    });

    return workspace;
  }

  async getUserWorkspaces(userId: string) {
    return this.repo.findUserWorkspaces(userId);
  }

  async getWorkspaceById(workspaceId: string) {
    const workspace = await this.repo.findWorkspaceById(workspaceId);
    if (!workspace) {
      throw new AppError(404, 'NOT_FOUND', 'Workspace not found');
    }
    return workspace;
  }

  async updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput) {
    if (input.slug) {
      const existing = await this.repo.findWorkspaceBySlug(input.slug);
      if (existing && existing.id !== workspaceId) {
        throw new AppError(409, 'CONFLICT', 'Workspace slug already taken');
      }
    }
    return this.repo.updateWorkspace(workspaceId, input);
  }

  async deleteWorkspace(workspaceId: string) {
    await this.repo.deleteWorkspace(workspaceId);
    return { message: 'Workspace deleted successfully' };
  }

  async getMembers(workspaceId: string) {
    return this.repo.findMembers(workspaceId);
  }

  async inviteMember(workspaceId: string, actorRole: Role, input: InviteMemberInput) {
    if (actorRole !== 'OWNER' && input.role === 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Only owners can invite members as owner');
    }

    const members = await this.repo.findMembers(workspaceId);
    const alreadyMember = members.some((m) => m.user.email === input.email);
    if (alreadyMember) {
      throw new AppError(409, 'CONFLICT', 'User is already a member of this workspace');
    }

    const workspace = await this.repo.findWorkspaceById(workspaceId);
    const rawToken = generateRandomToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.repo.createInvitation({
      workspaceId,
      email: input.email,
      role: input.role,
      tokenHash,
      expiresAt,
    });

    await emailService.sendInvitationEmail(input.email, workspace?.name ?? 'Workspace', rawToken);

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(userId: string, userEmail: string, token: string) {
    const tokenHash = hashToken(token);
    const invitation = await this.repo.findInvitationByTokenHash(tokenHash);

    if (!invitation || invitation.acceptedAt !== null || invitation.expiresAt < new Date()) {
      throw new AppError(400, 'INVALID_TOKEN', 'Invitation is invalid or has expired');
    }

    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new AppError(403, 'FORBIDDEN', 'This invitation was issued to a different email address');
    }

    const existingMember = await this.repo.findMember(invitation.workspaceId, userId);
    if (existingMember) {
      throw new AppError(409, 'CONFLICT', 'You are already a member of this workspace');
    }

    const member = await this.repo.acceptInvitation(
      invitation.id,
      invitation.workspaceId,
      userId,
      invitation.role,
    );

    return {
      workspaceId: member.workspaceId,
      role: member.role,
      workspaceName: invitation.workspace.name,
    };
  }

  async updateMemberRole(
    workspaceId: string,
    actorId: string,
    actorRole: Role,
    targetUserId: string,
    input: UpdateMemberRoleInput,
  ) {
    if (actorId === targetUserId) {
      throw new AppError(400, 'BAD_REQUEST', 'Cannot modify your own role');
    }

    const targetMember = await this.repo.findMember(workspaceId, targetUserId);
    if (!targetMember) {
      throw new AppError(404, 'NOT_FOUND', 'Member not found');
    }

    // Invariant: Admins cannot modify owners
    if (actorRole !== 'OWNER' && targetMember.role === 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Admins cannot modify owner roles');
    }

    // Invariant: Users cannot elevate anyone above their own role
    if (actorRole !== 'OWNER' && input.role === 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Cannot elevate user to owner');
    }

    // Invariant: A workspace must always have at least one owner
    if (targetMember.role === 'OWNER' && input.role !== 'OWNER') {
      const ownerCount = await this.repo.countOwners(workspaceId);
      if (ownerCount <= 1) {
        throw new AppError(400, 'INVARIANT_VIOLATION', 'Workspace must have at least one owner');
      }
    }

    return this.repo.updateMemberRole(workspaceId, targetUserId, input.role);
  }

  async removeMember(
    workspaceId: string,
    actorId: string,
    actorRole: Role,
    targetUserId: string,
  ) {
    const targetMember = await this.repo.findMember(workspaceId, targetUserId);
    if (!targetMember) {
      throw new AppError(404, 'NOT_FOUND', 'Member not found');
    }

    const isSelf = actorId === targetUserId;

    // Non-admins/owners cannot remove other members
    if (!isSelf && actorRole !== 'ADMIN' && actorRole !== 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Only admins and owners can remove other members');
    }

    // Invariant: Admins cannot remove owners
    if (!isSelf && actorRole !== 'OWNER' && targetMember.role === 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Admins cannot remove owners');
    }

    // Invariant: A workspace must always have at least one owner
    if (targetMember.role === 'OWNER') {
      const ownerCount = await this.repo.countOwners(workspaceId);
      if (ownerCount <= 1) {
        throw new AppError(
          400,
          'INVARIANT_VIOLATION',
          isSelf
            ? 'Last owner cannot leave without transferring ownership'
            : 'Cannot remove the last workspace owner',
        );
      }
    }

    await this.repo.removeMember(workspaceId, targetUserId);
    return { message: isSelf ? 'Left workspace successfully' : 'Member removed successfully' };
  }
}

export const workspacesService = new WorkspacesService();
