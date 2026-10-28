import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/utils/password.js';
import crypto from 'node:crypto';
import 'dotenv/config';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting database seed...');

  const passwordHash = await hashPassword('Password123!');

  // 1. Fast truncate for idempotent seeding
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE 
      "ActivityLog", 
      "Comment", 
      "Subtask", 
      "TaskAssignee", 
      "TaskTag", 
      "Task", 
      "Column", 
      "Board", 
      "Tag", 
      "Invitation", 
      "WorkspaceMember", 
      "Workspace", 
      "RefreshToken", 
      "Notification", 
      "IdempotencyKey",
      "OutboxEvent",
      "Attachment",
      "User" 
    CASCADE;
  `);

  // 2. Create Users
  const owner = await prisma.user.create({
    data: {
      email: 'owner@example.com',
      name: 'Alex Owner',
      passwordHash,
      emailVerified: true,
      timezone: 'UTC',
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      name: 'Sam Admin',
      passwordHash,
      emailVerified: true,
      timezone: 'America/New_York',
    },
  });

  const member = await prisma.user.create({
    data: {
      email: 'member@example.com',
      name: 'Jordan Member',
      passwordHash,
      emailVerified: true,
      timezone: 'Europe/London',
    },
  });

  const viewer = await prisma.user.create({
    data: {
      email: 'viewer@example.com',
      name: 'Taylor Viewer',
      passwordHash,
      emailVerified: true,
      timezone: 'Asia/Tokyo',
    },
  });

  console.log('✅ Users created');

  // 3. Create Workspace & Memberships
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Acme Corp',
      slug: 'acme-corp',
      members: {
        create: [
          { userId: owner.id, role: 'OWNER' },
          { userId: admin.id, role: 'ADMIN' },
          { userId: member.id, role: 'MEMBER' },
          { userId: viewer.id, role: 'VIEWER' },
        ],
      },
    },
  });

  console.log('✅ Workspace & Memberships created');

  // 4. Create Tags
  const backendTag = await prisma.tag.create({
    data: {
      workspaceId: workspace.id,
      name: 'Backend',
      color: '#3b82f6',
    },
  });

  const securityTag = await prisma.tag.create({
    data: {
      workspaceId: workspace.id,
      name: 'Security',
      color: '#ef4444',
    },
  });

  const frontendTag = await prisma.tag.create({
    data: {
      workspaceId: workspace.id,
      name: 'Frontend',
      color: '#10b981',
    },
  });

  console.log('✅ Tags created');

  // 5. Create Board & Columns with fractional indexing
  const board = await prisma.board.create({
    data: {
      workspaceId: workspace.id,
      name: 'Product Engineering Sprint',
      columns: {
        create: [
          { name: 'Backlog', position: 1000 },
          { name: 'Todo', position: 2000 },
          { name: 'In Progress', position: 3000 },
          { name: 'Done', position: 4000 },
        ],
      },
    },
    include: {
      columns: true,
    },
  });

  const backlogCol = board.columns.find((c) => c.name === 'Backlog')!;
  const todoCol = board.columns.find((c) => c.name === 'Todo')!;
  const inProgressCol = board.columns.find((c) => c.name === 'In Progress')!;
  const doneCol = board.columns.find((c) => c.name === 'Done')!;

  console.log('✅ Board & Columns created');

  // 6. Create Tasks, Subtasks, Tags, Assignees, and Comments
  const task1 = await prisma.task.create({
    data: {
      columnId: inProgressCol.id,
      workspaceId: workspace.id,
      title: 'Implement Authentication Flow',
      description: 'Implement JWT access + rotating refresh token family with Argon2 password hashing.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      position: 1000,
      createdById: owner.id,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      assignees: {
        create: [{ userId: owner.id }, { userId: admin.id }],
      },
      tags: {
        create: [{ tagId: backendTag.id }, { tagId: securityTag.id }],
      },
      subtasks: {
        create: [
          { title: 'Define Zod schemas', done: true },
          { title: 'Argon2 hashing service', done: true },
          { title: 'Rotate refresh token family', done: false },
        ],
      },
      comments: {
        create: [
          {
            authorId: admin.id,
            body: 'Argon2 parameters have been benchmarked for 100ms computation budget.',
          },
        ],
      },
    },
  });

  await prisma.task.create({
    data: {
      columnId: todoCol.id,
      workspaceId: workspace.id,
      title: 'Setup Kanban Drag-and-Drop Columns',
      description: 'Support fractional positioning midpoint reordering without mass row updates.',
      status: 'TODO',
      priority: 'MEDIUM',
      position: 1000,
      createdById: admin.id,
      assignees: {
        create: [{ userId: member.id }],
      },
      tags: {
        create: [{ tagId: frontendTag.id }],
      },
      subtasks: {
        create: [
          { title: 'Frontend kanban board component', done: false },
          { title: 'Fractional index update endpoint', done: false },
        ],
      },
    },
  });

  await prisma.task.create({
    data: {
      columnId: doneCol.id,
      workspaceId: workspace.id,
      title: 'Infrastructure & Docker Setup',
      description: 'Configure Docker Compose for PostgreSQL 16, Redis 7, and MailHog.',
      status: 'DONE',
      priority: 'HIGH',
      position: 1000,
      createdById: owner.id,
      assignees: {
        create: [{ userId: owner.id }],
      },
      tags: {
        create: [{ tagId: backendTag.id }],
      },
      subtasks: {
        create: [
          { title: 'Create docker-compose.yml', done: true },
          { title: 'Configure PostgreSQL & Redis healthchecks', done: true },
        ],
      },
    },
  });

  console.log('✅ Tasks & Subtasks created');

  // 7. Create Activity Log Entries
  await prisma.activityLog.createMany({
    data: [
      {
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        actorId: owner.id,
        entityType: 'workspace',
        entityId: workspace.id,
        action: 'workspace.created',
        metadata: { name: workspace.name },
      },
      {
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        actorId: owner.id,
        entityType: 'board',
        entityId: board.id,
        action: 'board.created',
        metadata: { name: board.name },
      },
      {
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        actorId: owner.id,
        entityType: 'task',
        entityId: task1.id,
        action: 'task.created',
        metadata: { title: task1.title },
      },
    ],
  });

  console.log('✅ Activity Logs created');
  console.log('🚀 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
