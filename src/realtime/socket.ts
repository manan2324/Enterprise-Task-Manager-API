import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { verifyAccessToken } from '../utils/token.js';
import { prisma } from '../config/prisma.js';
import { setSocketServer } from './events.js';

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.APP_URL,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Dedicated Redis pub/sub clients for Socket.io adapter
  try {
    const pubClient = new Redis(env.REDIS_URL, { lazyConnect: true });
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
  } catch (err) {
    logger.warn({ err }, 'Could not initialize Redis adapter for Socket.io, fallback to in-memory adapter');
  }

  // Socket authentication middleware
  io.use((socket, next) => {
    try {
      const authHeader =
        socket.handshake.auth?.['token'] ||
        socket.handshake.headers['authorization'];

      if (!authHeader) {
        return next(new Error('Authentication token required'));
      }

      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader;

      const payload = verifyAccessToken(token);
      socket.data['user'] = {
        id: payload.sub,
        email: payload.email,
      };

      next();
    } catch {
      next(new Error('Invalid or expired authentication token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data['user'] as { id: string; email: string };
    logger.info({ userId: user.id, socketId: socket.id }, 'Socket client connected');

    // Automatically join personal room for assignment alerts
    socket.join(`user:${user.id}`);

    // Join board room with workspace membership validation
    socket.on('join:board', async ({ boardId }: { boardId: string }) => {
      try {
        if (!boardId) return;

        const board = await prisma.board.findUnique({
          where: { id: boardId },
          select: { workspaceId: true },
        });

        if (!board) return;

        const member = await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: board.workspaceId,
              userId: user.id,
            },
          },
        });

        if (member) {
          socket.join(`board:${boardId}`);
          logger.debug({ userId: user.id, boardId }, 'Socket joined board room');
        }
      } catch (err) {
        logger.error({ err, boardId }, 'Error joining board room');
      }
    });

    socket.on('leave:board', ({ boardId }: { boardId: string }) => {
      if (boardId) {
        socket.leave(`board:${boardId}`);
      }
    });

    socket.on('disconnect', () => {
      logger.info({ userId: user.id, socketId: socket.id }, 'Socket client disconnected');
    });
  });

  setSocketServer(io);
  return io;
}
