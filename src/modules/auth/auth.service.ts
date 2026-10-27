import crypto from 'node:crypto';
import { authRepository, type AuthRepository } from './auth.repository.js';
import type {
  SignupInput,
  VerifyEmailInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.schemas.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import {
  hashToken,
  generateRandomToken,
  signAccessToken,
} from '../../utils/token.js';
import { emailService } from '../../services/email.service.js';
import { AppError } from '../../utils/app-error.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

// Pre-computed dummy argon2id hash to prevent timing attacks during failed logins
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$dGVzdHNhbHQxMjM0NTY3OA$t45W2Zl1h0ZJkWqL8e0i6s+rV9bH3M6u7p0gQ1dE2aA';

export class AuthService {
  constructor(private repo: AuthRepository = authRepository) {}

  async signup(input: SignupInput) {
    const existing = await this.repo.findUserByEmail(input.email);
    if (existing) {
      throw new AppError(409, 'CONFLICT', 'An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.repo.createUser({
      email: input.email,
      name: input.name,
      passwordHash,
    });

    const rawToken = generateRandomToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.repo.createAuthToken({
      userId: user.id,
      type: 'EMAIL_VERIFICATION',
      tokenHash,
      expiresAt,
    });

    await emailService.sendVerificationEmail(user.email, rawToken);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    };
  }

  async verifyEmail(input: VerifyEmailInput) {
    const tokenHash = hashToken(input.token);
    const token = await this.repo.findAuthToken(tokenHash, 'EMAIL_VERIFICATION');

    if (!token || token.expiresAt < new Date()) {
      throw new AppError(400, 'INVALID_TOKEN', 'Verification token is invalid or expired');
    }

    await this.repo.setUserEmailVerified(token.userId);
    await this.repo.deleteAuthToken(token.id);

    return { message: 'Email verified successfully' };
  }

  async login(input: LoginInput) {
    const user = await this.repo.findUserByEmail(input.email);

    // Constant-time comparison prevention of user enumeration
    const targetHash = user?.passwordHash ?? DUMMY_HASH;
    const isPasswordValid = await verifyPassword(targetHash, input.password);

    if (!user || !isPasswordValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    if (!user.emailVerified) {
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email before logging in');
    }

    const accessToken = signAccessToken({ sub: user.id, email: user.email });
    const rawRefreshToken = generateRandomToken();
    const refreshTokenHash = hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash: refreshTokenHash,
      familyId,
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async refresh(rawRefreshToken?: string) {
    if (!rawRefreshToken) {
      throw new AppError(401, 'UNAUTHORIZED', 'Refresh token required');
    }

    const tokenHash = hashToken(rawRefreshToken);
    const token = await this.repo.findRefreshToken(tokenHash);

    if (!token) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid refresh token');
    }

    // Reuse detection: revoked token presented signals theft → revoke entire family
    if (token.revokedAt !== null) {
      logger.warn({ familyId: token.familyId, userId: token.userId }, 'Token reuse detected! Revoking family');
      await this.repo.revokeRefreshTokenFamily(token.familyId);
      throw new AppError(401, 'TOKEN_REUSE_DETECTED', 'Token reuse detected. All sessions revoked');
    }

    if (token.expiresAt < new Date()) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token expired');
    }

    // Revoke presented token and issue next in family
    await this.repo.revokeRefreshToken(token.id);

    const user = await this.repo.findUserById(token.userId);
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'User not found');
    }

    const newRawRefreshToken = generateRandomToken();
    const newExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash: hashToken(newRawRefreshToken),
      familyId: token.familyId,
      expiresAt: newExpiresAt,
    });

    const accessToken = signAccessToken({ sub: user.id, email: user.email });

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
    };
  }

  async logout(rawRefreshToken?: string) {
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      const token = await this.repo.findRefreshToken(tokenHash);
      if (token && token.revokedAt === null) {
        await this.repo.revokeRefreshToken(token.id);
      }
    }
    return { message: 'Logged out successfully' };
  }

  async forgotPassword(input: ForgotPasswordInput) {
    const user = await this.repo.findUserByEmail(input.email);

    if (user) {
      await this.repo.deleteAuthTokensByUserAndType(user.id, 'PASSWORD_RESET');

      const rawToken = generateRandomToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await this.repo.createAuthToken({
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: hashToken(rawToken),
        expiresAt,
      });

      await emailService.sendPasswordResetEmail(user.email, rawToken);
    }

    // Anti-enumeration: identical response whether user exists or not
    return {
      message: 'If an account exists with that email, a password reset link has been sent',
    };
  }

  async resetPassword(input: ResetPasswordInput) {
    const tokenHash = hashToken(input.token);
    const token = await this.repo.findAuthToken(tokenHash, 'PASSWORD_RESET');

    if (!token || token.expiresAt < new Date()) {
      throw new AppError(400, 'INVALID_TOKEN', 'Reset token is invalid or expired');
    }

    const passwordHash = await hashPassword(input.password);

    await this.repo.updateUserPassword(token.userId, passwordHash);
    await this.repo.deleteAuthToken(token.id);

    // Revoke all refresh tokens for user (logs out all devices)
    await this.repo.revokeAllUserRefreshTokens(token.userId);

    return { message: 'Password has been reset successfully' };
  }
}

export const authService = new AuthService();
