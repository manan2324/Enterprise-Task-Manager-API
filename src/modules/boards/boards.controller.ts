import type { Request, Response } from 'express';
import { boardsService, type BoardsService } from './boards.service.js';
import { sendSuccess } from '../../utils/response.js';
import { getParam } from '../../utils/params.js';

export class BoardsController {
  constructor(private service: BoardsService = boardsService) {}

  createBoard = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id') || getParam(req, 'workspaceId');
    const board = await this.service.createBoard(workspaceId, req.body);
    sendSuccess(res, 201, board);
  };

  listWorkspaceBoards = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId || getParam(req, 'id') || getParam(req, 'workspaceId');
    const boards = await this.service.getBoardsByWorkspace(workspaceId);
    sendSuccess(res, 200, boards);
  };

  getBoard = async (req: Request, res: Response): Promise<void> => {
    const boardId = getParam(req, 'id');
    const board = await this.service.getBoardById(boardId);
    sendSuccess(res, 200, board);
  };

  updateBoard = async (req: Request, res: Response): Promise<void> => {
    const boardId = getParam(req, 'id');
    const board = await this.service.updateBoard(boardId, req.body);
    sendSuccess(res, 200, board);
  };

  deleteBoard = async (req: Request, res: Response): Promise<void> => {
    const boardId = getParam(req, 'id');
    const result = await this.service.deleteBoard(boardId);
    sendSuccess(res, 200, result);
  };

  createColumn = async (req: Request, res: Response): Promise<void> => {
    const boardId = getParam(req, 'id') || getParam(req, 'boardId');
    const column = await this.service.createColumn(boardId, req.body);
    sendSuccess(res, 201, column);
  };

  updateColumn = async (req: Request, res: Response): Promise<void> => {
    const columnId = getParam(req, 'id');
    const column = await this.service.updateColumn(columnId, req.body);
    sendSuccess(res, 200, column);
  };

  deleteColumn = async (req: Request, res: Response): Promise<void> => {
    const columnId = getParam(req, 'id');
    const result = await this.service.deleteColumn(columnId);
    sendSuccess(res, 200, result);
  };
}

export const boardsController = new BoardsController();
