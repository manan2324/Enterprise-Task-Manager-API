import type { Request, Response } from 'express';
import { authService, type AuthService } from './auth.service.js';
import { sendSuccess } from '../../utils/response.js';
import { env } from '../../config/env.js';

const REFRESH_COOKIE_NAME = 'refreshToken';

const getCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});

export class AuthController {
  constructor(private service: AuthService = authService) {}

  signup = async (req: Request, res: Response): Promise<void> => {
    const user = await this.service.signup(req.body);
    sendSuccess(res, 201, user);
  };

  verifyEmail = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.verifyEmail(req.body);
    sendSuccess(res, 200, result);
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.login(req.body);
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());
    sendSuccess(res, 200, {
      user: result.user,
      accessToken: result.accessToken,
    });
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const token = (req.cookies as Record<string, string>)[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    const result = await this.service.refresh(token);
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());
    sendSuccess(res, 200, {
      accessToken: result.accessToken,
    });
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const token = (req.cookies as Record<string, string>)[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    const result = await this.service.logout(token);
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
    sendSuccess(res, 200, result);
  };

  forgotPassword = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.forgotPassword(req.body);
    sendSuccess(res, 200, result);
  };

  resetPassword = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.resetPassword(req.body);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
    sendSuccess(res, 200, result);
  };
}

export const authController = new AuthController();
