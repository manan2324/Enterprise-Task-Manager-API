import { prisma } from '../../config/prisma.js';
import type { AuthTokenType, User, RefreshToken, AuthToken } from '../../generated/prisma/client.js';

export class AuthRepository {
  async findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  async findUserById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  async createUser(data: { email: string; name: string; passwordHash: string }): Promise<User> {
    return prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash: data.passwordHash,
        emailVerified: false,
      },
    });
  }

  async setUserEmailVerified(userId: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async createAuthToken(data: {
    userId: string;
    type: AuthTokenType;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AuthToken> {
    return prisma.authToken.create({
      data,
    });
  }

  async findAuthToken(tokenHash: string, type: AuthTokenType): Promise<AuthToken | null> {
    return prisma.authToken.findFirst({
      where: { tokenHash, type },
    });
  }

  async deleteAuthToken(id: string): Promise<void> {
    await prisma.authToken.delete({
      where: { id },
    });
  }

  async deleteAuthTokensByUserAndType(userId: string, type: AuthTokenType): Promise<void> {
    await prisma.authToken.deleteMany({
      where: { userId, type },
    });
  }

  async createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return prisma.refreshToken.create({
      data,
    });
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
  }

  async revokeRefreshToken(id: string): Promise<RefreshToken> {
    return prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export const authRepository = new AuthRepository();
