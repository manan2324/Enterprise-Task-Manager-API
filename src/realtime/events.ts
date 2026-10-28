import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '../config/logger.js';

let ioInstance: SocketIOServer | null = null;

export function setSocketServer(io: SocketIOServer): void {
  ioInstance = io;
}

export function getSocketServer(): SocketIOServer | null {
  return ioInstance;
}

export function emitToBoard(boardId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  logger.debug({ boardId, event }, 'Emitting realtime event to board room');
  ioInstance.to(`board:${boardId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  logger.debug({ userId, event }, 'Emitting realtime event to user room');
  ioInstance.to(`user:${userId}`).emit(event, payload);
}
