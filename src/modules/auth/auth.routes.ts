import { Router } from 'express';
import { authController } from './auth.controller.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import {
  signupSchema,
  verifyEmailSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schemas.js';
import {
  signupLimiter,
  loginLimiter,
  forgotPasswordLimiter,
} from '../../middlewares/rate-limiter.js';

const router = Router();

router.post(
  '/signup',
  signupLimiter,
  validate({ body: signupSchema }),
  asyncHandler(authController.signup),
);

router.post(
  '/verify-email',
  validate({ body: verifyEmailSchema }),
  asyncHandler(authController.verifyEmail),
);

router.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);

router.post(
  '/refresh',
  asyncHandler(authController.refresh),
);

router.post(
  '/logout',
  asyncHandler(authController.logout),
);

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(authController.forgotPassword),
);

router.post(
  '/reset-password',
  validate({ body: resetPasswordSchema }),
  asyncHandler(authController.resetPassword),
);

export { router as authRoutes };
