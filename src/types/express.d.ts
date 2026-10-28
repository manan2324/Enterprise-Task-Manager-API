import type { Role } from '../generated/prisma/client.js';

/**
 * Augment Express types with custom properties we attach via middleware.
 */
declare global {
  namespace Express {
    interface Request {
      /** Unique request ID (set by requestId middleware) */
      id: string;
      /** Authenticated user attached by authenticate middleware */
      user?: {
        id: string;
        email: string;
      };
      /** Workspace membership resolved by requireRole middleware */
      membership?: {
        workspaceId: string;
        userId: string;
        role: Role;
        joinedAt: Date;
      };
      /** Resolved workspace ID for current request context */
      workspaceId?: string;
    }
  }
}

export {};
