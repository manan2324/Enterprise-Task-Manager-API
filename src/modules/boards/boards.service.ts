import { boardsRepository, type BoardsRepository } from './boards.repository.js';
import { cacheService } from '../../services/cache.service.js';
import { emitToBoard } from '../../realtime/events.js';
import type {
  CreateBoardInput,
  UpdateBoardInput,
  CreateColumnInput,
  UpdateColumnInput,
} from './boards.schemas.js';
import { AppError } from '../../utils/app-error.js';

export class BoardsService {
  constructor(private repo: BoardsRepository = boardsRepository) {}

  async createBoard(workspaceId: string, input: CreateBoardInput) {
    const board = await this.repo.createBoard(workspaceId, input.name);

    // Create standard starter columns with fractional indices
    await this.repo.createColumn(board.id, 'To Do', 1000);
    await this.repo.createColumn(board.id, 'In Progress', 2000);
    await this.repo.createColumn(board.id, 'Done', 3000);

    return this.repo.findBoardWithColumns(board.id);
  }

  async getBoardsByWorkspace(workspaceId: string) {
    return this.repo.findBoardsByWorkspace(workspaceId);
  }

  async getBoardById(boardId: string) {
    const cached = await cacheService.getCachedBoard(boardId);
    if (cached) {
      return cached;
    }

    const board = await this.repo.findBoardWithColumns(boardId);
    if (!board) {
      throw new AppError(404, 'NOT_FOUND', 'Board not found');
    }

    await cacheService.setCachedBoard(boardId, board, 60);
    return board;
  }

  async updateBoard(boardId: string, input: UpdateBoardInput) {
    const board = await this.repo.findBoardById(boardId);
    if (!board) {
      throw new AppError(404, 'NOT_FOUND', 'Board not found');
    }
    const updated = await this.repo.updateBoard(boardId, input.name);
    await cacheService.invalidateBoard(boardId);
    emitToBoard(boardId, 'board.updated', updated);
    return updated;
  }

  async deleteBoard(boardId: string) {
    const board = await this.repo.findBoardById(boardId);
    if (!board) {
      throw new AppError(404, 'NOT_FOUND', 'Board not found');
    }
    await this.repo.deleteBoard(boardId);
    await cacheService.invalidateBoard(boardId);
    return { message: 'Board deleted successfully' };
  }

  async createColumn(boardId: string, input: CreateColumnInput) {
    const board = await this.repo.findBoardById(boardId);
    if (!board) {
      throw new AppError(404, 'NOT_FOUND', 'Board not found');
    }

    let position = input.position;
    if (position === undefined) {
      const highest = await this.repo.findHighestColumnPosition(boardId);
      position = highest > 0 ? highest + 1000 : 1000;
    }

    const column = await this.repo.createColumn(boardId, input.name, position);
    await cacheService.invalidateBoard(boardId);
    emitToBoard(boardId, 'board.updated', { columnId: column.id });
    return column;
  }

  async updateColumn(columnId: string, input: UpdateColumnInput) {
    const column = await this.repo.findColumnById(columnId);
    if (!column) {
      throw new AppError(404, 'NOT_FOUND', 'Column not found');
    }
    const updated = await this.repo.updateColumn(columnId, input);
    await cacheService.invalidateBoard(column.boardId);
    emitToBoard(column.boardId, 'board.updated', { columnId });
    return updated;
  }

  async deleteColumn(columnId: string) {
    const column = await this.repo.findColumnById(columnId);
    if (!column) {
      throw new AppError(404, 'NOT_FOUND', 'Column not found');
    }
    await this.repo.deleteColumn(columnId);
    await cacheService.invalidateBoard(column.boardId);
    emitToBoard(column.boardId, 'board.updated', { columnId });
    return { message: 'Column deleted successfully' };
  }
}

export const boardsService = new BoardsService();

