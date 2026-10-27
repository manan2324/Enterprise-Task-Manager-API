import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password must not exceed 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const signupSchema = z
  .object({
    email: z.string().email('Valid email address is required').toLowerCase().trim(),
    password: passwordSchema,
    name: z.string().min(2, 'Name must be at least 2 characters long').max(100).trim(),
  })
  .strict();

export const verifyEmailSchema = z
  .object({
    token: z.string().min(1, 'Verification token is required').trim(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().email('Valid email address is required').toLowerCase().trim(),
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: z.string().email('Valid email address is required').toLowerCase().trim(),
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Reset token is required').trim(),
    password: passwordSchema,
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
