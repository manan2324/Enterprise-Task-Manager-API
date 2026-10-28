import { boardsRepository, type BoardsRepository } from './boards.repository.js';
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
    const board = await this.repo.findBoardWithColumns(boardId);
    if (!board) {
      throw new AppError(404, 'NOT_FOUND', 'Board not found');
    }
    return board;
  }

  async updateBoard(boardId: string, input: UpdateBoardInput) {
    const board = await this.repo.findBoardById(boardId);
    if (!board) {
      throw new AppError(404, 'NOT_FOUND', 'Board not found');
    }
    return this.repo.updateBoard(boardId, input.name);
  }

  async deleteBoard(boardId: string) {
    const board = await this.repo.findBoardById(boardId);
    if (!board) {
      throw new AppError(404, 'NOT_FOUND', 'Board not found');
    }
    await this.repo.deleteBoard(boardId);
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

    return this.repo.createColumn(boardId, input.name, position);
  }

  async updateColumn(columnId: string, input: UpdateColumnInput) {
    const column = await this.repo.findColumnById(columnId);
    if (!column) {
      throw new AppError(404, 'NOT_FOUND', 'Column not found');
    }
    return this.repo.updateColumn(columnId, input);
  }

  async deleteColumn(columnId: string) {
    const column = await this.repo.findColumnById(columnId);
    if (!column) {
      throw new AppError(404, 'NOT_FOUND', 'Column not found');
    }
    await this.repo.deleteColumn(columnId);
    return { message: 'Column deleted successfully' };
  }
}

export const boardsService = new BoardsService();

