import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { hashToken } from '../../src/utils/token.js';

const getSetCookie = (res: request.Response): string => {
  const cookies = res.headers['set-cookie'];
  if (!cookies || !cookies[0]) {
    throw new Error('Expected set-cookie header on response');
  }
  return cookies[0];
};

describe('Auth Module Integration', () => {
  const testUser = {
    email: 'auth_test_user@example.com',
    password: 'SecurePassword123!',
    name: 'Auth Test User',
  };

  beforeEach(async () => {
    // Clean up test user and associated records before each test
    const user = await prisma.user.findUnique({ where: { email: testUser.email } });
    if (user) {
      await prisma.authToken.deleteMany({ where: { userId: user.id } });
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  describe('POST /auth/signup', () => {
    it('creates a new user and returns 201 with emailVerified false', async () => {
      const res = await request(app)
        .post('/auth/signup')
        .send(testUser);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        email: testUser.email,
        name: testUser.name,
        emailVerified: false,
      });
      expect(res.body.data.id).toBeDefined();

      // Verify AuthToken record created in DB
      const dbToken = await prisma.authToken.findFirst({
        where: { userId: res.body.data.id, type: 'EMAIL_VERIFICATION' },
      });
      expect(dbToken).not.toBeNull();
    });

    it('returns 409 conflict when email already exists', async () => {
      await request(app).post('/auth/signup').send(testUser);
      const res = await request(app).post('/auth/signup').send(testUser);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('returns 400 when password does not meet requirements', async () => {
      const res = await request(app).post('/auth/signup').send({
        email: 'invalid_pass@example.com',
        name: 'Invalid Pass',
        password: 'weak',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/verify-email', () => {
    it('verifies user email and activates account with valid token', async () => {
      const signupRes = await request(app).post('/auth/signup').send(testUser);
      const userId = signupRes.body.data.id;

      // In real flow, token sent via email. For test, find token in DB:
      const dbAuthToken = await prisma.authToken.findFirst({
        where: { userId, type: 'EMAIL_VERIFICATION' },
      });
      expect(dbAuthToken).not.toBeNull();
      if (!dbAuthToken) throw new Error('Auth token not found in database');

      // We need a known raw token, so let's generate and store one
      const rawToken = 'known-verification-token-12345';
      await prisma.authToken.update({
        where: { id: dbAuthToken.id },
        data: { tokenHash: hashToken(rawToken) },
      });

      const verifyRes = await request(app)
        .post('/auth/verify-email')
        .send({ token: rawToken });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.message).toBe('Email verified successfully');

      // Check user is now verified in DB
      const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
      expect(updatedUser?.emailVerified).toBe(true);

      // Verify token was deleted (single-use)
      const tokenAfter = await prisma.authToken.findFirst({
        where: { id: dbAuthToken.id },
      });
      expect(tokenAfter).toBeNull();
    });

    it('returns 400 on invalid or expired verification token', async () => {
      const res = await request(app)
        .post('/auth/verify-email')
        .send({ token: 'non-existent-token' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('POST /auth/login', () => {
    it('blocks unverified user from logging in with 403', async () => {
      await request(app).post('/auth/signup').send(testUser);

      const res = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('returns 401 on incorrect password with constant error code', async () => {
      const signupRes = await request(app).post('/auth/signup').send(testUser);
      await prisma.user.update({
        where: { id: signupRes.body.data.id },
        data: { emailVerified: true },
      });

      const res = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: 'WrongPassword123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 401 on non-existent email (anti-enumeration)', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'nobody@example.com',
        password: 'Password123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 200 with access token and sets refresh cookie on successful login', async () => {
      const signupRes = await request(app).post('/auth/signup').send(testUser);
      await prisma.user.update({
        where: { id: signupRes.body.data.id },
        data: { emailVerified: true },
      });

      const res = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.email).toBe(testUser.email);

      // Verify cookie
      const cookies = res.headers['set-cookie'] as string[] | undefined;
      expect(cookies).toBeDefined();
      expect(cookies?.[0]).toMatch(/refreshToken=/);
      expect(cookies?.[0]).toMatch(/HttpOnly/i);
    });
  });

  describe('POST /auth/refresh (Rotation & Reuse Detection)', () => {
    it('rotates refresh token, issuing new access and refresh tokens', async () => {
      const signupRes = await request(app).post('/auth/signup').send(testUser);
      await prisma.user.update({
        where: { id: signupRes.body.data.id },
        data: { emailVerified: true },
      });

      const loginRes = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      const initialCookie = getSetCookie(loginRes);

      // Refresh using cookie
      const refreshRes = await request(app)
        .post('/auth/refresh')
        .set('Cookie', initialCookie);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.accessToken).toBeDefined();

      const rotatedCookie = getSetCookie(refreshRes);
      expect(rotatedCookie).toBeDefined();
      expect(rotatedCookie).not.toBe(initialCookie);
    });

    it('detects reuse of revoked token and revokes entire token family', async () => {
      const signupRes = await request(app).post('/auth/signup').send(testUser);
      await prisma.user.update({
        where: { id: signupRes.body.data.id },
        data: { emailVerified: true },
      });

      const loginRes = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      const initialCookie = getSetCookie(loginRes);

      // First valid refresh
      const refresh1 = await request(app)
        .post('/auth/refresh')
        .set('Cookie', initialCookie);
      expect(refresh1.status).toBe(200);
      const secondCookie = getSetCookie(refresh1);

      // REUSE ATTEMPT: Attacker presents the initial (now revoked) token
      const reuseRes = await request(app)
        .post('/auth/refresh')
        .set('Cookie', initialCookie);

      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      // Now, even the legitimate second token must be rejected because the whole family was revoked
      const legitimateSubsequent = await request(app)
        .post('/auth/refresh')
        .set('Cookie', secondCookie);

      expect(legitimateSubsequent.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes refresh token and clears cookie', async () => {
      const signupRes = await request(app).post('/auth/signup').send(testUser);
      await prisma.user.update({
        where: { id: signupRes.body.data.id },
        data: { emailVerified: true },
      });

      const loginRes = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      const cookie = getSetCookie(loginRes);

      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Cookie', cookie);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.data.message).toBe('Logged out successfully');

      // Subsequent refresh must fail
      const refreshAfterLogout = await request(app)
        .post('/auth/refresh')
        .set('Cookie', cookie);

      expect(refreshAfterLogout.status).toBe(401);
    });
  });

  describe('POST /auth/forgot-password & /auth/reset-password', () => {
    it('returns 200 on forgot-password whether email exists or not (anti-enumeration)', async () => {
      const res1 = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'nobody_123456@example.com' });

      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post('/auth/forgot-password')
        .send({ email: testUser.email });

      expect(res2.status).toBe(200);
    });

    it('resets password, allows login with new password, and revokes all active sessions', async () => {
      const signupRes = await request(app).post('/auth/signup').send(testUser);
      const userId = signupRes.body.data.id;
      await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      });

      // Login to get an active session
      const loginRes = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });
      const sessionCookie = getSetCookie(loginRes);

      // Request password reset
      await request(app).post('/auth/forgot-password').send({ email: testUser.email });

      const dbResetToken = await prisma.authToken.findFirst({
        where: { userId, type: 'PASSWORD_RESET' },
      });
      expect(dbResetToken).not.toBeNull();
      if (!dbResetToken) throw new Error('Reset token not found in database');

      const rawResetToken = 'test-reset-token-abcdef';
      await prisma.authToken.update({
        where: { id: dbResetToken.id },
        data: { tokenHash: hashToken(rawResetToken) },
      });

      const newPassword = 'NewSecretPassword987!';
      const resetRes = await request(app).post('/auth/reset-password').send({
        token: rawResetToken,
        password: newPassword,
      });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.data.message).toBe('Password has been reset successfully');

      // Previous session must be invalidated
      const refreshAttempt = await request(app)
        .post('/auth/refresh')
        .set('Cookie', sessionCookie);
      expect(refreshAttempt.status).toBe(401);

      // Old password should fail
      const oldLogin = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });
      expect(oldLogin.status).toBe(401);

      // New password should succeed
      const newLogin = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: newPassword,
      });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.data.accessToken).toBeDefined();
    });
  });
});
