import type { Request, Response } from 'express';
import { tasksService, type TasksService } from './tasks.service.js';
import { activityService } from '../activity/activity.service.js';
import { sendSuccess } from '../../utils/response.js';
import { getParam } from '../../utils/params.js';
import { AppError } from '../../utils/app-error.js';

function extractIfMatchVersion(req: Request): number | undefined {
  const header = req.header('if-match');
  if (!header) return undefined;
  const cleaned = header.replace(/^"|"$/g, '').trim();
  const parsed = parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export class TasksController {
  constructor(private service: TasksService = tasksService) {}

  createTask = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const columnId = getParam(req, 'id') || getParam(req, 'columnId');
    const task = await this.service.createTask(req.user.id, columnId, req.body);
    sendSuccess(res, 201, task);
  };

  getTask = async (req: Request, res: Response): Promise<void> => {
    const taskId = getParam(req, 'id');
    const task = await this.service.getTaskById(taskId);
    sendSuccess(res, 200, task);
  };

  updateTask = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const ifMatchVersion = extractIfMatchVersion(req);
    const updated = await this.service.updateTask(req.user.id, taskId, req.body, ifMatchVersion);
    sendSuccess(res, 200, updated);
  };

  moveTask = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const ifMatchVersion = extractIfMatchVersion(req);
    const moved = await this.service.moveTask(req.user.id, taskId, req.body, ifMatchVersion);
    sendSuccess(res, 200, moved);
  };

  deleteTask = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const result = await this.service.deleteTask(req.user.id, taskId);
    sendSuccess(res, 200, result);
  };

  updateAssignees = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const updated = await this.service.updateAssignees(req.user.id, taskId, req.body.userIds);
    sendSuccess(res, 200, updated);
  };

  updateTags = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const updated = await this.service.updateTags(req.user.id, taskId, req.body.tagIds);
    sendSuccess(res, 200, updated);
  };

  createSubtask = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const subtask = await this.service.createSubtask(req.user.id, taskId, req.body);
    sendSuccess(res, 201, subtask);
  };

  updateSubtask = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const subtaskId = getParam(req, 'subtaskId');
    const updated = await this.service.updateSubtask(req.user.id, taskId, subtaskId, req.body);
    sendSuccess(res, 200, updated);
  };

  deleteSubtask = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const subtaskId = getParam(req, 'subtaskId');
    const result = await this.service.deleteSubtask(req.user.id, taskId, subtaskId);
    sendSuccess(res, 200, result);
  };

  createComment = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const comment = await this.service.createComment(req.user.id, taskId, req.body);
    sendSuccess(res, 201, comment);
  };

  getComments = async (req: Request, res: Response): Promise<void> => {
    const taskId = getParam(req, 'id');
    const comments = await this.service.getComments(taskId);
    sendSuccess(res, 200, comments);
  };

  getTaskActivity = async (req: Request, res: Response): Promise<void> => {
    const taskId = getParam(req, 'id');
    const activity = await this.service.getActivity(taskId);
    sendSuccess(res, 200, activity);
  };

  getBoardActivity = async (req: Request, res: Response): Promise<void> => {
    const boardId = getParam(req, 'id');
    const activity = await activityService.getBoardActivity(boardId);
    sendSuccess(res, 200, activity);
  };

  searchBoardTasks = async (req: Request, res: Response): Promise<void> => {
    const boardId = getParam(req, 'id');
    const { data, nextCursor, hasNext } = await this.service.searchBoardTasks(boardId, req.query as never);
    sendSuccess(res, 200, data, { nextCursor, hasNext });
  };

  presignAttachment = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const result = await this.service.presignAttachment(req.user.id, taskId, req.body);
    sendSuccess(res, 200, result);
  };

  confirmAttachment = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const taskId = getParam(req, 'id');
    const attachment = await this.service.confirmAttachment(req.user.id, taskId, req.body);
    sendSuccess(res, 201, attachment);
  };

  getAttachmentUrl = async (req: Request, res: Response): Promise<void> => {
    const attachmentId = getParam(req, 'id');
    const result = await this.service.getAttachmentDownloadUrl(attachmentId);
    sendSuccess(res, 200, result);
  };

  listAttachments = async (req: Request, res: Response): Promise<void> => {
    const taskId = getParam(req, 'id');
    const attachments = await this.service.getTaskAttachments(taskId);
    sendSuccess(res, 200, attachments);
  };

  deleteAttachment = async (req: Request, res: Response): Promise<void> => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED');
    const attachmentId = getParam(req, 'id');
    const result = await this.service.deleteAttachment(req.user.id, attachmentId);
    sendSuccess(res, 200, result);
  };
}

export const tasksController = new TasksController();
