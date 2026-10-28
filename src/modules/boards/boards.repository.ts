import { prisma } from '../../config/prisma.js';
import type { Board, Column } from '../../generated/prisma/client.js';

export class BoardsRepository {
  async createBoard(workspaceId: string, name: string): Promise<Board> {
    return prisma.board.create({
      data: {
        workspaceId,
        name,
      },
    });
  }

  async findBoardsByWorkspace(workspaceId: string): Promise<Board[]> {
    return prisma.board.findMany({
      where: { workspaceId },
      include: {
        _count: {
          select: { columns: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findBoardById(id: string): Promise<Board | null> {
    return prisma.board.findUnique({
      where: { id },
    });
  }

  async findBoardWithColumns(id: string) {
    return prisma.board.findUnique({
      where: { id },
      include: {
        columns: {
          orderBy: { position: 'asc' },
          include: {
            _count: {
              select: { tasks: true },
            },
          },
        },
      },
    });
  }

  async updateBoard(id: string, name: string): Promise<Board> {
    return prisma.board.update({
      where: { id },
      data: { name },
    });
  }

  async deleteBoard(id: string): Promise<void> {
    await prisma.board.delete({
      where: { id },
    });
  }

  async findHighestColumnPosition(boardId: string): Promise<number> {
    const highest = await prisma.column.findFirst({
      where: { boardId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return highest ? Number(highest.position) : 0;
  }

  async createColumn(boardId: string, name: string, position: number): Promise<Column> {
    return prisma.column.create({
      data: {
        boardId,
        name,
        position,
      },
    });
  }

  async findColumnById(id: string): Promise<Column | null> {
    return prisma.column.findUnique({
      where: { id },
    });
  }

  async updateColumn(id: string, data: { name?: string; position?: number }): Promise<Column> {
    return prisma.column.update({
      where: { id },
      data,
    });
  }

  async deleteColumn(id: string): Promise<void> {
    await prisma.column.delete({
      where: { id },
    });
  }
}

export const boardsRepository = new BoardsRepository();

