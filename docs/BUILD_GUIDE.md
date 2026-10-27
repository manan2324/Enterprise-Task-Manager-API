# Enterprise Task Manager API — Step-by-Step Build Guide

> A Trello/Asana-style backend built in **TypeScript**, tested, documented, containerised and deployed.
> Written as a senior-developer playbook: every phase tells you **what to build, why, how, and how to know it's done**.

**Definition of Done:** a reviewer can clone the repo, run `docker compose up`, run the tests green, and hit the live HTTPS URL.

---

## Table of Contents

1. [Guiding Principles](#1-guiding-principles)
2. [Tech Stack & Decisions](#2-tech-stack--decisions)
3. [Milestone Roadmap](#3-milestone-roadmap)
4. [Step 35 — Planning & Architecture](#4-step-35--planning--architecture)
5. [Step 36 — Core Features](#5-step-36--core-features)
6. [Step 37 — Advanced Features](#6-step-37--advanced-features)
7. [Step 38 — Quality, Deployment & Polish](#7-step-38--quality-deployment--polish)
8. [Scalability Playbook](#8-scalability-playbook)
9. [README Template](#9-readme-template)
10. [Final Checklist](#10-final-checklist)

**Part II — Production-Scale Hardening (1M+ users)**

11. [Gap Audit](#11-gap-audit--what-the-first-pass-missed)
12. [Capacity Planning & SLOs](#12-capacity-planning--slos)
13. [Data Layer at Scale](#13-data-layer-at-scale)
14. [Reliability Patterns](#14-reliability-patterns)
15. [Notifications, Realtime & Reminders at Scale](#15-notifications-realtime--reminders-at-scale)
16. [Security & Compliance Hardening](#16-security--compliance-hardening)
17. [Observability at Scale](#17-observability-at-scale)
18. [Node.js Performance Tuning](#18-nodejs-performance-tuning)
19. [Load Testing & Chaos](#19-load-testing--chaos)
20. [Delivery & Operations](#20-delivery--operations)
21. [API Design Standards](#21-api-design-standards)
22. [Scale-Up Roadmap](#22-scale-up-roadmap)
23. [Updated Final Checklist](#23-updated-final-checklist)

---

## 1. Guiding Principles

| Principle | What it means in this project |
|---|---|
| **Modular monolith first** | One deployable, strict module boundaries. Easy to split later (workers, notifications) without a rewrite. |
| **Stateless API** | No in-memory sessions. State lives in Postgres/Redis so you can run N replicas behind a load balancer. |
| **Validate at the edge** | Zod validates env, request bodies, params and queries. Types are *inferred* from schemas — single source of truth. |
| **Thin controllers, fat services** | Controllers parse/respond; services hold business logic; repositories talk to the DB. |
| **Transactions for invariants** | Anything that must be atomic (change + activity log, ordering updates) is one DB transaction. |
| **Observable by default** | Structured logs with request IDs, `/health`, error tracking from day one. |
| **Automate everything** | Lint, format, test, build, deploy all run in CI. No manual steps for a reviewer. |

---

## 2. Tech Stack & Decisions

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js (current Active LTS) | Stability; manage via `nvm`/`fnm` |
| Language | TypeScript (`strict: true`) | Catches bugs at compile time |
| Framework | **Express** (or Fastify) | Express is universal; Fastify is faster — either is fine. Examples below use Express |
| Database | **PostgreSQL** | See justification below |
| ORM | **Prisma** (or Drizzle) | Type-safe queries, migrations, great DX |
| Cache / queues | **Redis** | Cache, rate limiting, BullMQ backing store, Socket.io adapter |
| Jobs | **BullMQ** | Reliable retries, delayed/repeatable jobs |
| Realtime | **Socket.io** + Redis adapter | Rooms per board; scales across replicas |
| Storage | **S3 / Cloudflare R2** | Pre-signed URLs keep file bytes off your API |
| Validation | **Zod** | Env, DTOs, OpenAPI generation |
| Docs | `zod-to-openapi` + Swagger UI | Docs generated from the same schemas that validate |
| Logging | **pino** + `pino-http` | Fast JSON logs, request IDs |
| Errors | **Sentry** | Production error tracking |
| Tests | **Vitest** (or Jest) + **Supertest** + Testcontainers | Real DB for integration tests |
| CI/CD | **GitHub Actions** | Free, integrates with deploy hosts |
| Hosting | Render / Railway / Fly.io + Neon / Supabase (DB) + Upstash (Redis) | Free tiers, HTTPS included |

### Why PostgreSQL over MongoDB (put this in your README)

- **The domain is relational.** Users ↔ workspaces ↔ boards ↔ tasks ↔ tags ↔ comments have many-to-many links (memberships, task–tag, assignees). Joins and foreign keys model this naturally.
- **Integrity matters.** FK constraints, unique constraints (`one membership per user per workspace`) and `CHECK`s enforce rules the app can't forget.
- **Transactions are first-class.** The "change + activity log in one transaction" requirement is trivial and reliable.
- **Rich querying.** Filtering by status/priority/assignee/due date with composite indexes and keyset pagination is a strength of SQL.
- **Trade-off acknowledged:** schema changes need migrations, and highly nested/unstructured data (e.g. activity `metadata`) is handled with `JSONB`, which gives most of the flexibility of a document store where needed.

---

## 3. Milestone Roadmap

A realistic ~4–5 week plan (adjust to your pace).

| Week | Focus | Output |
|---|---|---|
| **1** | Step 35 — planning, repo, tooling, DB design, Docker, config | Running skeleton + `/health`, ER diagram, CI lint job |
| **2** | Step 36 — auth, workspaces/boards/roles, tasks, activity log | Core API working end-to-end |
| **3** | Step 37 — search/filter/pagination, attachments, caching, rate limits | Performance + features |
| **4** | Step 37 cont. — Socket.io, BullMQ jobs; Step 38 — tests, docs | Realtime + jobs + 70% coverage |
| **5** | Step 38 — observability, CI/CD, deploy, README, cleanup | Live URL, polished repo |

> **Rule:** finish each vertical slice (route → service → repo → test → doc) before starting the next. Never leave a half-built module.

---

## 4. Step 35 — Planning & Architecture

### 4.1 Requirements

**Functional**

- **Users:** register, verify email, log in, manage profile.
- **Workspaces:** group boards and members; roles `OWNER | ADMIN | MEMBER | VIEWER`; invitations.
- **Boards:** belong to a workspace; contain ordered **columns** (lists).
- **Tasks:** live in a column; title, description, status, priority, due date, assignees, position (ordering).
- **Subtasks:** child items (checklist) of a task.
- **Tags:** workspace-scoped labels attached to tasks.
- **Comments:** threaded-or-flat discussion on tasks.
- **Activity log:** immutable record of who changed what and when.
- **Attachments:** files on tasks (S3/R2).
- **Notifications:** realtime + email on assignment; daily due-date reminders.

**Non-functional**

| Area | Target |
|---|---|
| Security | OWASP Top 10 mitigations, hashed passwords (argon2/bcrypt), short-lived access tokens, rotating refresh tokens, rate-limited auth |
| Performance | p95 < 200 ms for board reads (cached), indexed filters, cursor pagination |
| Reliability | Graceful shutdown, retryable jobs, idempotent workers |
| Scalability | Stateless API, horizontal scale, Redis adapter for sockets |
| Maintainability | Feature-based modules, strict TS, ≥70% coverage on core modules |

### 4.2 Role & Permission Matrix

| Action | Viewer | Member | Admin | Owner |
|---|:-:|:-:|:-:|:-:|
| View boards/tasks | ✅ | ✅ | ✅ | ✅ |
| Create/edit tasks, comment | ❌ | ✅ | ✅ | ✅ |
| Create/edit/delete boards | ❌ | ❌ | ✅ | ✅ |
| Invite/remove members, change roles | ❌ | ❌ | ✅ (not owners) | ✅ |
| Delete workspace / transfer ownership | ❌ | ❌ | ❌ | ✅ |

Implement this as a **single policy map** (`role → allowed actions`) used by a `requireRole()` middleware — never scatter `if (role === ...)` through services.

### 4.3 ER Diagram

Paste into [Mermaid](https://mermaid.live), Eraser.io, or dbdiagram.io, and export an image for the README.

```mermaid
erDiagram
    USER ||--o{ WORKSPACE_MEMBER : has
    WORKSPACE ||--o{ WORKSPACE_MEMBER : has
    WORKSPACE ||--o{ BOARD : contains
    WORKSPACE ||--o{ TAG : defines
    WORKSPACE ||--o{ INVITATION : issues
    BOARD ||--o{ COLUMN : has
    COLUMN ||--o{ TASK : holds
    TASK ||--o{ SUBTASK : has
    TASK ||--o{ COMMENT : has
    TASK ||--o{ ATTACHMENT : has
    TASK ||--o{ TASK_ASSIGNEE : has
    TASK ||--o{ TASK_TAG : has
    USER ||--o{ TASK_ASSIGNEE : assigned
    TAG ||--o{ TASK_TAG : labels
    USER ||--o{ COMMENT : writes
    USER ||--o{ REFRESH_TOKEN : owns
    WORKSPACE ||--o{ ACTIVITY_LOG : records
    USER ||--o{ ACTIVITY_LOG : performs
    USER ||--o{ NOTIFICATION : receives
    USER ||--o{ IDEMPOTENCY_KEY : sends
```

> `OUTBOX_EVENT` is an infrastructure table (no FKs) — see Part II, §13.

### 4.4 Prisma Schema (starting point)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role { OWNER ADMIN MEMBER VIEWER }
enum TaskStatus { TODO IN_PROGRESS IN_REVIEW DONE }
enum Priority { LOW MEDIUM HIGH URGENT }

model User {
  id            String   @id @default(uuid())
  email         String   @unique
  name          String
  passwordHash  String?
  emailVerified Boolean  @default(false)
  googleId      String?  @unique
  timezone      String   @default("UTC")   // IANA tz, drives reminder scheduling
  deletedAt     DateTime?                  // soft delete / GDPR erasure workflow
  notifications Notification[]
  createdAt     DateTime @default(now())
  memberships   WorkspaceMember[]
  assignments   TaskAssignee[]
  comments      Comment[]
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id         String    @id @default(uuid())
  userId     String
  tokenHash  String    @unique
  familyId   String    // for rotation / reuse detection
  expiresAt  DateTime
  revokedAt  DateTime?
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model Workspace {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  members   WorkspaceMember[]
  boards    Board[]
  tags      Tag[]
  invites   Invitation[]
}

model WorkspaceMember {
  workspaceId String
  userId      String
  role        Role
  joinedAt    DateTime @default(now())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([workspaceId, userId])
  @@index([userId])
}

model Invitation {
  id          String   @id @default(uuid())
  workspaceId String
  email       String
  role        Role
  tokenHash   String   @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, email])
}

model Board {
  id          String   @id @default(uuid())
  workspaceId String
  name        String
  createdAt   DateTime @default(now())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  columns     Column[]
  @@index([workspaceId])
}

model Column {
  id       String @id @default(uuid())
  boardId  String
  name     String
  position Decimal @db.Decimal(20, 10)   // fractional indexing
  board    Board  @relation(fields: [boardId], references: [id], onDelete: Cascade)
  tasks    Task[]
  @@index([boardId, position])
}

model Task {
  id          String     @id @default(uuid())
  columnId    String
  title       String
  description String?
  status      TaskStatus @default(TODO)
  priority    Priority   @default(MEDIUM)
  dueDate     DateTime?
  position    Decimal    @db.Decimal(20, 10)
  createdById String
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  version     Int        @default(1)     // optimistic concurrency control
  deletedAt   DateTime?                  // soft delete (hard-purge via job)
  workspaceId String                     // denormalised: cheap authz + shard key
  column      Column     @relation(fields: [columnId], references: [id], onDelete: Cascade)
  subtasks    Subtask[]
  comments    Comment[]
  attachments Attachment[]
  assignees   TaskAssignee[]
  tags        TaskTag[]

  @@index([columnId, position])
  @@index([status, priority])
  @@index([dueDate])
  @@index([workspaceId, status, priority])
  @@index([workspaceId, deletedAt])
  @@index([createdAt, id])           // cursor pagination
}

model Subtask {
  id     String  @id @default(uuid())
  taskId String
  title  String
  done   Boolean @default(false)
  task   Task    @relation(fields: [taskId], references: [id], onDelete: Cascade)
  @@index([taskId])
}

model TaskAssignee {
  taskId String
  userId String
  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([taskId, userId])
  @@index([userId])
}

model Tag {
  id          String @id @default(uuid())
  workspaceId String
  name        String
  color       String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  tasks       TaskTag[]
  @@unique([workspaceId, name])
}

model TaskTag {
  taskId String
  tagId  String
  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([taskId, tagId])
}

model Comment {
  id        String   @id @default(uuid())
  taskId    String
  authorId  String
  body      String
  createdAt DateTime @default(now())
  task      Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  author    User @relation(fields: [authorId], references: [id])
  @@index([taskId, createdAt])
}

model Attachment {
  id        String   @id @default(uuid())
  taskId    String
  key       String   // object-storage key
  fileName  String
  mimeType  String
  sizeBytes Int
  uploadedBy String
  createdAt DateTime @default(now())
  task      Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  @@index([taskId])
}

model Notification {
  id        String    @id @default(uuid())
  userId    String
  type      String    // "task.assigned" | "task.due_soon" | "invite.received"
  payload   Json
  readAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, readAt, createdAt])
}

// Transactional outbox: written in the SAME transaction as the business change
model OutboxEvent {
  id          BigInt    @id @default(autoincrement())
  aggregate   String    // "task"
  aggregateId String
  type        String    // "task.assigned"
  payload     Json
  createdAt   DateTime  @default(now())
  processedAt DateTime?
  @@index([processedAt, id])
}

model IdempotencyKey {
  key          String   // client-supplied Idempotency-Key header
  userId       String
  requestHash  String   // detects key reuse with a different body
  responseCode Int?
  responseBody Json?
  createdAt    DateTime @default(now())
  @@id([userId, key])
  @@index([createdAt])  // TTL purge (e.g. 24h)
}

model ActivityLog {
  id          String   @id @default(uuid())
  workspaceId String
  actorId     String
  entityType  String   // "task" | "board" | "member" ...
  entityId    String
  action      String   // "task.created" | "task.moved" ...
  metadata    Json?    // { from, to } diffs
  createdAt   DateTime @default(now())
  @@index([workspaceId, createdAt])
  @@index([entityType, entityId])
}
```

**Design notes**

- **UUIDs** (or ULIDs) avoid enumeration and are safe to expose.
- **Fractional `position`** (e.g. midpoint between neighbours) lets you reorder a task by updating **one row**, not shifting every row. Rebalance occasionally if precision runs low.
- **Hash** refresh/invite/verification tokens in the DB — never store raw tokens.
- **Indexes mirror your query patterns** — verify with `EXPLAIN ANALYZE`.

### 4.5 Repository & Tooling Setup

```bash
mkdir task-manager-api && cd task-manager-api
git init
npm init -y
npm i express zod pino pino-http dotenv cors helmet cookie-parser
npm i -D typescript tsx @types/node @types/express eslint prettier \
  typescript-eslint eslint-config-prettier husky lint-staged vitest supertest @types/supertest
npx tsc --init
```

**`tsconfig.json`** (strict mode, modern output)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src"]
}
```

**Husky + lint-staged**

```bash
npx husky init
echo "npx lint-staged" > .husky/pre-commit
```

```json
// package.json
"lint-staged": { "*.{ts,json,md}": ["prettier --write"], "*.ts": ["eslint --fix"] },
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "tsc -p tsconfig.build.json",
  "start": "node dist/server.js",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:cov": "vitest run --coverage"
}
```

Add an ESLint rule `"no-console": "error"` now — it enforces the "no `console.log`" cleanup requirement automatically.

### 4.6 Feature-Based Folder Structure

```
task-manager-api/
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts
├─ src/
│  ├─ app.ts                 # builds Express app (no listen) — testable
│  ├─ server.ts              # listen + graceful shutdown
│  ├─ config/
│  │  ├─ env.ts              # Zod-validated env
│  │  ├─ logger.ts           # pino
│  │  └─ redis.ts / prisma.ts
│  ├─ modules/
│  │  ├─ auth/               # routes, controller, service, schema, tests
│  │  ├─ users/
│  │  ├─ workspaces/         # includes members + invitations
│  │  ├─ boards/             # boards + columns
│  │  ├─ tasks/              # tasks + subtasks + tags + assignees
│  │  ├─ comments/
│  │  ├─ attachments/
│  │  ├─ activity/
│  │  ├─ notifications/      # socket + email dispatch
│  │  └─ search/
│  ├─ jobs/
│  │  ├─ queues.ts
│  │  ├─ workers/            # assignmentEmail.worker.ts, dueReminder.worker.ts
│  │  └─ worker.ts           # separate process entrypoint
│  ├─ realtime/              # socket.io setup, auth, rooms
│  ├─ middlewares/           # auth, requireRole, validate, errorHandler, rateLimit, requestId
│  ├─ utils/                 # AppError, asyncHandler, pagination, token, hash, position
│  └─ docs/                  # OpenAPI registry
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ helpers/               # test DB setup, factories
├─ docker-compose.yml
├─ Dockerfile
├─ .github/workflows/ci.yml
├─ .env.example
├─ .eslintrc / eslint.config.js
├─ .prettierrc
└─ README.md
```

**Each module follows the same shape:**

```
modules/tasks/
├─ tasks.routes.ts        # URL → middleware chain → controller
├─ tasks.controller.ts    # HTTP in/out only
├─ tasks.service.ts       # business rules, transactions
├─ tasks.repository.ts    # Prisma queries (optional but recommended)
├─ tasks.schemas.ts       # Zod schemas + inferred types + OpenAPI meta
└─ tasks.service.test.ts
```

### 4.7 Docker Compose for Local Services

```yaml
# docker-compose.yml
services:
  api:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    command: sh -c "npx prisma migrate deploy && node dist/server.js"

  worker:
    build: .
    env_file: .env
    depends_on: [postgres, redis]
    command: node dist/jobs/worker.js

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: taskmanager
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d taskmanager"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  mailhog:                 # catches emails locally
    image: mailhog/mailhog
    ports: ["1025:1025", "8025:8025"]

volumes:
  pgdata:
```

> For local development you can run only infra (`docker compose up postgres redis mailhog`) and use `npm run dev` on the host for hot reload.

### 4.8 Environment Validation with Zod

```ts
// src/config/env.ts
import { z } from 'zod';
import 'dotenv/config';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  APP_URL: z.string().url(),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  S3_BUCKET: z.string(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().url().optional(),   // R2 endpoint
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  SENTRY_DSN: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);                       // fail fast at startup
}
export const env = parsed.data;
```

*(This is the one place `console` is acceptable because the logger isn't up yet — add an ESLint override for this file.)*

### 4.9 Core Plumbing (build before features)

1. **`AppError` class** (`statusCode`, `code`, `details`) + central `errorHandler` middleware that maps Zod errors, Prisma errors (e.g. `P2002` → 409) and unknowns (→ 500, logged).
2. **`asyncHandler`** wrapper (or Express 5, which handles async errors natively).
3. **`validate(schema)`** middleware validating `body`, `params`, `query`.
4. **`requestId`** middleware (`crypto.randomUUID()`, echo in `X-Request-Id`), attached to the pino child logger.
5. **`/health`** endpoint (liveness) and **`/ready`** (checks DB + Redis).
6. **Standard response envelope** — `{ data, meta? }` for success, `{ error: { code, message, details? } }` for failure.

✅ **Checkpoint 35:** `docker compose up` starts infra; `npm run dev` serves `/health`; CI runs lint + typecheck; ER diagram + DB justification drafted.

---

## 5. Step 36 — Core Features

### 5.1 Auth Module

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` | Create user, send verification email |
| POST | `/auth/verify-email` | Consume verification token |
| POST | `/auth/login` | Return access token + set refresh cookie |
| POST | `/auth/refresh` | Rotate refresh token, issue new access token |
| POST | `/auth/logout` | Revoke current refresh token |
| POST | `/auth/forgot-password` | Email a reset link (always returns 200) |
| POST | `/auth/reset-password` | Set new password, revoke all sessions |
| GET | `/auth/google` · `/auth/google/callback` | *(Stretch)* Google OAuth |

**Implementation guidance**

- **Passwords:** `argon2id` (or bcrypt cost ≥ 12). Never log or return hashes.
- **Access token:** JWT, ~15 min, payload `{ sub, email }` only. Sent as `Authorization: Bearer`.
- **Refresh token:** random 256-bit string; store **SHA-256 hash** in DB; send as `HttpOnly; Secure; SameSite=Strict` cookie.
- **Rotation + reuse detection:** every refresh issues a new token in the same `familyId` and revokes the old one. If a *revoked* token is presented, revoke the entire family (token theft signal).
- **Email verification / reset:** single-use, expiring (e.g. 24h / 1h), hashed in DB. Block login until verified (configurable).
- **Anti-enumeration:** login and forgot-password return identical messages/timing whether or not the email exists.
- **Rate limit** auth routes (see §6.5).
- **`authenticate` middleware:** verifies JWT, attaches `req.user`.

**Tests to write now:** signup → verify → login; wrong password; expired token; refresh rotation; refresh reuse revokes family; reset flow.

### 5.2 Workspace & Board Module

**Workspaces**

- `POST /workspaces` — creator becomes `OWNER` (in one transaction with the membership row).
- `GET /workspaces` — only those the user belongs to.
- `PATCH /workspaces/:id`, `DELETE /workspaces/:id` (owner only).

**Members & invitations**

- `POST /workspaces/:id/invitations` `{ email, role }` → generates hashed token, queues invite email.
- `POST /invitations/accept` `{ token }` → creates membership (validates email matches or user is logged in).
- `PATCH /workspaces/:id/members/:userId` (change role), `DELETE …` (remove / leave).
- **Invariants:** a workspace always has ≥1 owner; admins can't modify owners; users can't elevate above their own role.

**Boards & columns**

- `POST /workspaces/:id/boards`, `GET /workspaces/:id/boards`
- `GET /boards/:id` — board with columns and tasks (the hot path → cache in §6.4)
- `PATCH/DELETE /boards/:id`
- `POST /boards/:id/columns`, `PATCH /columns/:id` (rename/reorder)

**Authorization pattern**

```ts
// middlewares/requireRole.ts
const rank = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 } as const;

export const requireRole = (min: keyof typeof rank) =>
  asyncHandler(async (req, _res, next) => {
    const workspaceId = await resolveWorkspaceId(req); // from board/task/etc.
    const member = await membershipRepo.find(workspaceId, req.user.id);
    if (!member) throw new AppError(404, 'NOT_FOUND');          // don't leak existence
    if (rank[member.role] < rank[min]) throw new AppError(403, 'FORBIDDEN');
    req.membership = member;
    next();
  });
```

> **Security rule:** always check *resource → workspace → membership*. Never trust IDs alone — this prevents IDOR (insecure direct object reference), a top OWASP risk.

### 5.3 Task Module

**Endpoints**

| Method | Path | Notes |
|---|---|---|
| POST | `/columns/:columnId/tasks` | Create at end (or between two neighbours) |
| GET | `/tasks/:id` | Full detail |
| PATCH | `/tasks/:id` | Title, description, status, priority, dueDate |
| PATCH | `/tasks/:id/move` | `{ columnId, beforeTaskId?, afterTaskId? }` |
| DELETE | `/tasks/:id` | |
| PUT | `/tasks/:id/assignees` | Replace assignees (validate they're workspace members) |
| POST/PATCH/DELETE | `/tasks/:id/subtasks` | Checklist items |
| PUT | `/tasks/:id/tags` | Attach tags (must belong to same workspace) |
| POST/GET | `/tasks/:id/comments` | |

**Ordering with fractional positions**

```ts
// utils/position.ts
export function between(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return after! / 2;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}
```

Moving a task = compute `between(prev.position, next.position)` and update **one row**. If the gap becomes tiny (< 1e-6), run a rebalance job for that column.

### 5.4 Activity Log (same transaction!)

The requirement: *the log entry must be written inside the same transaction as the change.* If the change rolls back, the log must too — and vice-versa.

```ts
// modules/tasks/tasks.service.ts
async function updateTask(actor: AuthUser, id: string, input: UpdateTaskInput) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.task.findUniqueOrThrow({ where: { id } });
    const after  = await tx.task.update({ where: { id }, data: input });

    await activity.record(tx, {
      workspaceId,
      actorId: actor.id,
      entityType: 'task',
      entityId: id,
      action: 'task.updated',
      metadata: diff(before, after),     // { status: { from: 'TODO', to: 'DONE' } }
    });
    return after;
  });
}
```

- `activity.record(tx, …)` **accepts the transaction client** — that's the whole trick.
- Expose `GET /boards/:id/activity` and `GET /tasks/:id/activity` with cursor pagination.
- **Side effects (emails, sockets, cache invalidation) go AFTER commit** — never inside the transaction. Use the outbox pattern (§8) if you need guaranteed delivery.

✅ **Checkpoint 36:** a user can sign up, verify, log in, create a workspace, invite someone, create a board, create/move/assign tasks, comment — and every change appears in the activity log. Integration tests cover auth + permissions.

---

## 6. Step 37 — Advanced Features

### 6.1 Search & Filter with Cursor Pagination

**Endpoint:** `GET /boards/:id/tasks?status=&priority=&assignee=&dueBefore=&dueAfter=&q=&limit=20&cursor=`

**Why cursor (keyset) pagination?** `OFFSET 100000` scans and discards rows — it's slow and unstable when data changes. Keyset pagination uses an indexed `(createdAt, id)` pair and stays fast at any depth.

```ts
// utils/pagination.ts
export const encodeCursor = (o: { createdAt: Date; id: string }) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
export const decodeCursor = (c: string) => JSON.parse(Buffer.from(c, 'base64url').toString());

// in repository
const items = await prisma.task.findMany({
  where: {
    column: { boardId },
    ...(status && { status }),
    ...(priority && { priority }),
    ...(assignee && { assignees: { some: { userId: assignee } } }),
    ...(dueBefore && { dueDate: { lte: dueBefore } }),
    ...(cursor && {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    }),
  },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: limit + 1,                         // fetch one extra to detect hasNext
});
const hasNext = items.length > limit;
const page = hasNext ? items.slice(0, -1) : items;
const nextCursor = hasNext ? encodeCursor(page.at(-1)!) : null;
```

- **Indexes:** composite indexes matching the filters you use most (e.g. `(columnId, status, priority)`, `(dueDate)`), plus `(createdAt, id)`.
- **Text search:** start with `ILIKE`; upgrade to Postgres full-text (`tsvector` + GIN index) when it matters.
- **Verify:** run `EXPLAIN ANALYZE` and confirm index scans, not sequential scans. Include before/after numbers in your README.

### 6.2 Attachments (S3 / R2 with Pre-signed URLs)

**Flow (the API never touches file bytes):**

```
Client ──(1) POST /tasks/:id/attachments/presign {fileName, mimeType, size}──► API
API    ──validate type/size/permission, create key, return pre-signed PUT URL──► Client
Client ──(2) PUT file directly──► S3/R2
Client ──(3) POST /tasks/:id/attachments/confirm {key}──► API
API    ──HEAD object to verify existence/size → save Attachment row──► DB
Download: GET /attachments/:id/url → short-lived pre-signed GET URL
```

- **Validate** MIME allow-list (`image/png`, `application/pdf`, …) and max size (e.g. 10 MB) **server-side** before signing; embed `ContentType` and `ContentLength` constraints in the signature.
- **Key naming:** `workspaces/{wid}/tasks/{tid}/{uuid}-{sanitisedName}` — never trust the client's filename.
- **Short expiry** (5–15 min) on URLs; check permission on every download-URL request.
- Use `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2 is S3-compatible — just set `endpoint`).
- **Optional hardening:** orphan cleanup job (uploads never confirmed), malware scanning.

### 6.3 Real-Time with Socket.io

- **Auth:** verify the JWT in the Socket.io handshake middleware.
- **Rooms:** `user:{userId}` (personal notifications) and `board:{boardId}` (board changes). Join board room only after a membership check.
- **Events:** `task.assigned` (to the assignee's user room), `board.updated` / `task.moved` / `task.created` (to the board room).
- **Emit after commit.** Wrap in a small `events` module so services don't import Socket.io directly:

```ts
// realtime/events.ts
export const emitToBoard = (boardId: string, event: string, payload: unknown) =>
  io.to(`board:${boardId}`).emit(event, payload);
```

- **Scale-out:** use `@socket.io/redis-adapter` so events reach clients connected to *other* API replicas.
- **Don't send the world.** Emit small payloads (IDs + changed fields); clients refetch details if needed.

### 6.4 Redis Caching & Invalidation

**What to cache:** the `GET /boards/:id` read (columns + tasks summary) — it's read-heavy.

**Pattern — cache-aside:**

```ts
async function getBoard(id: string) {
  const key = `board:${id}:v1`;
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);

  const board = await boardRepo.fetchFull(id);
  await redis.set(key, JSON.stringify(board), 'EX', 60);   // short TTL as a safety net
  return board;
}
```

**Invalidation:** any write that affects a board (task create/update/move/delete, column change, assignee/tag change) calls `redis.del('board:{id}:v1')` **after the transaction commits**.

- Always keep a **TTL** so a missed invalidation self-heals.
- Prevent **cache stampede** on hot keys with a short lock (`SET NX`) or request coalescing.
- Namespace keys and version them (`:v1`) so schema changes can't read stale shapes.
- Cache only data that is the same for all viewers (do permission checks *before* serving cached data).

### 6.5 Rate Limiting

- Use `rate-limiter-flexible` or `express-rate-limit` with a **Redis store** (so limits are shared across replicas).
- Suggested limits: `/auth/login` 5/min per IP+email, `/auth/signup` 10/hour per IP, `/auth/forgot-password` 3/hour per email, global API 100/min per user/IP.
- Return `429` with `Retry-After`.
- Set `app.set('trust proxy', 1)` behind a load balancer so you rate-limit the real client IP.

### 6.6 Background Jobs with BullMQ

**Run workers as a separate process** (`src/jobs/worker.ts`) so heavy work never blocks API latency, and you can scale workers independently.

| Queue | Trigger | Worker action |
|---|---|---|
| `assignment-email` | After commit of an assignee change | Send "You were assigned…" email |
| `due-reminders` | **Repeatable job**, daily at e.g. 08:00 | Query tasks due in next 24h → enqueue one email job per user (digest) |
| `invitation-email` | Invitation created | Send invite link |
| `cleanup` *(optional)* | Nightly | Delete expired tokens, unconfirmed uploads |

```ts
// jobs/queues.ts
export const emailQueue = new Queue('assignment-email', { connection: redis });

await emailQueue.add('send', payload, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
});

// repeatable daily reminder
await reminderQueue.add('daily', {}, { repeat: { pattern: '0 8 * * *' } });
```

- **Idempotent workers:** a retry must not send duplicate emails (use a `jobId` like `assign:{taskId}:{userId}`).
- Handle failed jobs (dead-letter view; log + Sentry).
- Gracefully close workers on shutdown (`await worker.close()`).

✅ **Checkpoint 37:** filtered + paginated queries are indexed and measured; uploads work via pre-signed URLs; two browser tabs see live updates; assignment email lands in MailHog; board reads hit cache; auth routes are rate-limited.

---

## 7. Step 38 — Quality, Deployment & Polish

### 7.1 API Documentation (OpenAPI from Zod)

Generate docs from the **same Zod schemas** you use for validation so they can never drift.

```bash
npm i @asteasolutions/zod-to-openapi swagger-ui-express
```

```ts
// docs/registry.ts
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();
registry.registerPath({
  method: 'post', path: '/tasks/{id}/move',
  request: { params: IdParam, body: { content: { 'application/json': { schema: MoveTaskBody } } } },
  responses: { 200: { description: 'Task moved', content: { 'application/json': { schema: TaskResponse } } } },
  security: [{ bearerAuth: [] }],
});

export const openApiDoc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.3', info: { title: 'Enterprise Task Manager API', version: '1.0.0' },
});
// app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
```

Serve at `/docs`, and expose raw JSON at `/openapi.json`. Link the live docs from the README.

### 7.2 Testing Strategy (target ≥ 70% on core modules)

| Layer | Scope | Tooling | Notes |
|---|---|---|---|
| **Unit** | Services, utils (position, pagination, permissions, token logic) | Vitest | Mock repositories/Redis/mailer |
| **Integration** | Auth, permissions, task flows through real HTTP | Vitest + Supertest + **real Postgres** | Testcontainers or a dedicated test DB in CI service containers |
| **Contract/smoke** | `/health`, `/docs`, OpenAPI validity | Supertest | Fast sanity check post-deploy |

**Integration test setup**

1. Spin up Postgres (+ Redis) via Testcontainers or CI `services:`.
2. Run `prisma migrate deploy` once in global setup.
3. Truncate tables (or wrap each test in a transaction) between tests.
4. Use **factories** (`createUser()`, `createWorkspace()`, `createTask()`) to keep tests readable.

**Must-have scenarios**

- Auth: signup/verify/login/refresh rotation/reuse detection/reset.
- Permissions: each role against each protected action; user from workspace A **cannot** read workspace B (IDOR test).
- Tasks: create → move → reorder → assign → comment → activity log entries created; **rollback test** proving no activity row exists if the update fails.
- Pagination: stable ordering, no duplicates/skips across pages.
- Rate limit: 6th login attempt returns 429.

```bash
npx vitest run --coverage      # enforce thresholds in vitest.config.ts
```

```ts
// vitest.config.ts
coverage: { thresholds: { lines: 70, functions: 70, branches: 65 },
            include: ['src/modules/**', 'src/utils/**'] }
```

### 7.3 Observability

- **pino** with `pino-http`: JSON logs, `reqId` on every line, redact secrets (`req.headers.authorization`, `*.password`, cookies). Pretty-print only in dev (`pino-pretty`).
- **`/health`** (liveness: process up) and **`/ready`** (readiness: DB + Redis ping). Use them in Docker `HEALTHCHECK` and the host's health probe.
- **Sentry:** init first (`Sentry.init`), attach request context + user ID, capture unhandled errors in the global error handler (skip expected 4xx), tag release with the git SHA. Capture worker job failures too.
- *(Stretch)* Prometheus metrics endpoint (`prom-client`) for request latency/queue depth.

### 7.4 Dockerfile (multi-stage, small, non-root)

```dockerfile
# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

Add a `.dockerignore` (`node_modules`, `dist`, `.env`, `.git`, `tests`).

### 7.5 GitHub Actions CI/CD

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: taskmanager_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U app" --health-interval 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    env:
      DATABASE_URL: postgresql://app:app@localhost:5432/taskmanager_test
      REDIS_URL: redis://localhost:6379
      # …other test env values
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint
      - run: npm run typecheck
      - run: npx prisma migrate deploy
      - run: npm run test:cov
      - run: npm run build

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Trigger deploy
        run: curl -X POST "${{ secrets.RENDER_DEPLOY_HOOK }}"   # or: flyctl deploy / railway up
```

Pipeline order: **lint → typecheck → migrate → test → build → deploy**. Store secrets in GitHub Secrets, never in the repo.

### 7.6 Deployment to a Public HTTPS URL

1. **Database:** create a free Postgres on Neon or Supabase → copy the connection string.
2. **Redis:** Upstash (free) or the host's Redis add-on.
3. **Storage:** Cloudflare R2 or S3 bucket + CORS rule allowing your frontend origin + restricted IAM keys.
4. **Host the API + worker:** Render / Railway / Fly.io → two services from the same image (`api` and `worker` commands).
5. Set **all env vars** in the host dashboard (they must satisfy your Zod schema or the app refuses to start — that's a feature).
6. **Run migrations** as a release/pre-deploy command: `npx prisma migrate deploy`.
7. Enable HTTPS (automatic on these platforms) and configure the health-check path to `/health`.
8. Smoke test: hit `/health`, `/docs`, sign up, verify via real email provider (Resend/Brevo/SMTP).
9. Add the live URL + docs URL to the README.

### 7.7 Cleanup & Hardening

- [ ] **No `console.log`** (ESLint `no-console` enforced).
- [ ] **Short functions** (≈ ≤ 30 lines); extract helpers; one responsibility each.
- [ ] **Consistent naming:** `camelCase` vars, `PascalCase` types, `kebab-case` files, REST plural nouns, `verbNoun` service methods.
- [ ] **Graceful shutdown:**

```ts
// server.ts
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {                 // stop accepting new connections
    await Promise.allSettled([
      io.close(), worker?.close(), prisma.$disconnect(), redis.quit(), Sentry.close(2000),
    ]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();   // force-exit failsafe
};
['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, () => shutdown(s)));
process.on('unhandledRejection', (e) => { logger.error(e); /* Sentry capture */ });
```

- [ ] **Security headers** (`helmet`), strict **CORS** allow-list, body size limit (`express.json({ limit: '1mb' })`), `npm audit` in CI.
- [ ] **OWASP Top 10 pass:** broken access control (IDOR tests), injection (Prisma parameterises; validate everything), auth failures (rate limit, rotation), security misconfiguration, vulnerable deps.
- [ ] **Seed script** (`prisma/seed.ts`) giving reviewers demo users/workspace/board.

✅ **Checkpoint 38:** CI green, coverage ≥ 70%, live HTTPS URL, Swagger docs online, polished README.

---

## 8. Scalability Playbook

Design choices made here, and how they extend when traffic grows.

| Bottleneck | Today | When you outgrow it |
|---|---|---|
| **API CPU** | Stateless Express; run multiple replicas behind the host's load balancer | Autoscale replicas; use `cluster`/PM2 per container if needed |
| **DB reads** | Indexed queries + Redis cache-aside for boards | Add **read replicas** (route reads via Prisma read-replica extension); materialised views for dashboards |
| **DB writes** | Single primary, short transactions, fractional ordering (1 row per move) | Partition `activity_log` by time; archive old rows; connection pooling via **PgBouncer** |
| **Connections** | Prisma pool | PgBouncer / Neon pooler (essential on serverless) |
| **Realtime** | Socket.io rooms | **Redis adapter** across replicas; sticky sessions or WebSocket-only transport |
| **Slow work** | BullMQ workers in a separate process | Scale workers horizontally; separate queues by priority; rate-limit per queue |
| **Side-effect reliability** | Emit after commit | **Transactional outbox:** write an `outbox` row inside the transaction; a relay publishes to BullMQ/Redis. Guarantees no lost events |
| **Large files** | Pre-signed direct-to-storage uploads | CDN in front of the bucket; image thumbnails via a worker |
| **Search** | Postgres indexes / `tsvector` | Dedicated engine (OpenSearch/Meilisearch) fed by the outbox |
| **Abuse** | Redis rate limits | WAF / API gateway (Cloudflare) |
| **Monolith size** | Modular boundaries (modules never import each other's repositories, only services/interfaces) | Extract `notifications` or `search` into their own service with minimal rewrite |

**Habits that preserve scalability from day one**

1. **Never** store state in process memory (sessions, caches, socket maps) without a shared backing store.
2. **Every list endpoint is paginated** and has a max `limit`.
3. **Every query you ship has a matching index** (check with `EXPLAIN`).
4. **Keep transactions short** — no network calls inside them.
5. **Make workers idempotent** and handlers safe to retry.
6. **Config via environment**, validated at boot (12-factor).
7. **Version your API** (`/api/v1`) so breaking changes don't break clients.

---

## 9. README Template

```markdown
# Enterprise Task Manager API
One-line pitch + badges (CI status, coverage).

**Live:** https://… · **API Docs:** https://…/docs

## Features
Bullet list mapped to modules.

## Architecture
Diagram (Eraser/Draw.io image) + short explanation of modules, request flow,
and the API / worker / Redis / Postgres / S3 relationships.

## Database
ER diagram + **why PostgreSQL** (see §2) + notable indexes.

## Local Setup
1. `git clone … && cd …`
2. `cp .env.example .env`
3. `docker compose up --build`
4. `npm run prisma:seed` (optional demo data)
5. Open http://localhost:3000/docs  (MailHog UI: http://localhost:8025)

## Running Tests
`npm test` / `npm run test:cov`  (requires Docker for Postgres/Redis)

## Environment Variables
Table: name · required · description · example.

## Design Decisions & Trade-offs
- Modular monolith vs microservices
- Fractional ordering vs integer positions
- Cursor vs offset pagination
- Short-lived access + rotating refresh tokens
- Cache-aside with TTL + explicit invalidation
- Emit-after-commit vs outbox (and when to adopt outbox)

## Security
Summary of OWASP mitigations.

## Deployment
Hosting, CI/CD flow, how to roll back.

## Roadmap
Google login, full-text search engine, audit export, webhooks.
```

---

## 10. Final Checklist

**Step 35 — Planning**
- [ ] Requirements + role matrix written
- [ ] ER diagram exported; DB choice justified in README
- [ ] Repo with strict TS, ESLint, Prettier, Husky, lint-staged
- [ ] Feature-based folders; Docker Compose (Postgres, Redis, MailHog)
- [ ] Zod-validated env fails fast at startup

**Step 36 — Core**
- [ ] Signup, verify email, login, access + refresh (rotation), logout, reset password
- [ ] Workspaces, boards, columns with 4 roles + invitations
- [ ] Task CRUD, assignees, status/priority, due dates, ordering within columns
- [ ] Activity log written in the **same transaction**

**Step 37 — Advanced**
- [ ] Filters + cursor pagination, indexed, verified with `EXPLAIN`
- [ ] S3/R2 pre-signed uploads with type/size validation
- [ ] Socket.io notifications (assignment + board changes)
- [ ] BullMQ workers: assignment emails + daily due-date reminders
- [ ] Redis board cache with invalidation; rate limits on auth routes

**Step 38 — Quality**
- [ ] OpenAPI/Swagger generated from Zod
- [ ] Unit + integration tests (real DB), ≥ 70% coverage on core modules
- [ ] pino + request IDs, `/health`, Sentry
- [ ] Dockerfile, GitHub Actions, live HTTPS deployment
- [ ] No `console.log`, short functions, consistent naming, graceful shutdown
- [ ] README with architecture diagram, setup, env vars, docs link, trade-offs

**Reviewer test (Definition of Done)**
1. `git clone` → 2. `docker compose up` → 3. `npm test` is green → 4. Live URL responds over HTTPS ✅

---

### Suggested Build Order (Daily Slices)

| Day | Slice |
|---|---|
| 1 | Repo, tooling, Docker, env validation, `/health`, error handler, logger |
| 2 | Prisma schema, migrations, seed, ER diagram |
| 3–4 | Auth (signup/verify/login/refresh/logout/reset) + tests |
| 5–6 | Workspaces, memberships, roles, invitations + permission tests |
| 7–8 | Boards, columns, tasks, ordering |
| 9 | Subtasks, tags, assignees, comments |
| 10 | Activity log (transactional) + tests |
| 11 | Filters, cursor pagination, indexes |
| 12 | Attachments (pre-signed URLs) |
| 13 | Redis cache + rate limiting |
| 14 | Socket.io realtime |
| 15 | BullMQ jobs (assignment email, daily reminders) |
| 16–17 | Test hardening to ≥ 70%, OpenAPI docs |
| 18 | Sentry, readiness checks, graceful shutdown, cleanup |
| 19 | Dockerfile, CI pipeline |
| 20 | Deploy, smoke test, README, final review |

> **Senior-dev tip:** commit small and often with conventional messages (`feat(tasks): add move endpoint`), open a PR per slice even if you're solo, and keep `main` always deployable. A clean Git history is part of the portfolio.

---
---

# PART II — Production-Scale Hardening (1M+ Users)

> Part I gets you a correct, deployable system. Part II is what a 15-year engineer adds so it keeps working at **millions of registered users, tens of thousands of concurrent connections, and hundreds of millions of rows** — without a rewrite.

---

## 11. Gap Audit — What the First Pass Missed

| # | Gap | Why it matters at scale | Fixed in |
|---|---|---|---|
| 1 | No capacity math / SLOs | You can't scale what you haven't sized | §12 |
| 2 | No optimistic concurrency | Two users editing one task silently overwrite each other | §13.2 |
| 3 | No idempotency keys | Mobile retries / double-clicks create duplicate tasks | §14.1 |
| 4 | Outbox only *mentioned* | Emit-after-commit loses events on crash | §14.2 |
| 5 | No persisted notifications | Realtime-only means offline users miss everything | §15.1 |
| 6 | Reminders ignore time zones | "8 AM" is wrong for most of your users | §15.3 |
| 7 | Unbounded tables (`activity_log`, `outbox`, tokens) | Table bloat, slow vacuum, slow queries | §13.4 |
| 8 | No connection pooling plan | Postgres falls over at a few hundred connections | §13.3 |
| 9 | Cache and queues share Redis | Cache eviction can delete queued jobs | §14.4 |
| 10 | No timeouts / circuit breakers / backpressure | One slow dependency cascades into full outage | §14.3 |
| 11 | No soft delete / retention / GDPR | Legal risk and accidental data loss | §13.5, §16 |
| 12 | No metrics, tracing, alerting | Logs alone can't tell you *why* p95 doubled | §17 |
| 13 | Event-loop blocking risks (argon2, big JSON) | One request stalls every request on that process | §18 |
| 14 | No load testing | You find the limit in production instead | §19 |
| 15 | No backup/DR, zero-downtime migrations, rollback | Deploys and incidents become outages | §20 |
| 16 | Security gaps (CSRF on cookie, JWT key rotation, lockout, SSRF, RLS) | Breach risk grows with user count | §16 |
| 17 | API conventions (ETag, rate-limit headers, versioning) | Hard to change once clients depend on you | §21 |
| 18 | Hot-path payload: whole board in one response | Large boards → MBs per request | §13.6 |

---

## 12. Capacity Planning & SLOs

Do the back-of-envelope **before** choosing infrastructure. These are *illustrative assumptions* — replace with your own.

**Assumptions:** 1M registered users · 20% daily active (200k DAU) · ~100 API calls per active user/day · peak = 5× average · 10% of DAU connected via WebSocket at peak.

| Metric | Calculation | Result |
|---|---|---|
| Avg RPS | 200k × 100 / 86,400 | ≈ 230 req/s |
| **Peak RPS** | 230 × 5 | **≈ 1,200 req/s** |
| Read : write ratio | typical for boards | ~90 : 10 → ~120 writes/s at peak |
| Concurrent sockets | 200k × 10% | ~20,000 |
| Socket memory | 20k × ~50 KB | ~1 GB (spread over ≥ 2–4 nodes) |
| Tasks rows | 1M users × ~50 | ~50M (~25 GB at ~500 B/row) |
| Activity rows | ~10 events per task | ~500M → **must partition** |
| Daily reminder emails | 200k DAU × ~1 digest | ~200k/day (~2–3/s sustained, bursty) |

**What this tells you**

- 1,200 RPS is **not** much for Node if the DB isn't the bottleneck → 4–8 small API replicas + cache is plenty.
- The **database** (storage, indexes, activity log) and **sockets** are the real scaling concerns.
- Read-heavy → cache + read replicas pay off; writes stay on one primary for a long time.

**Service Level Objectives (write these in the README)**

| SLO | Target |
|---|---|
| Availability (API) | 99.9% monthly (~43 min downtime budget) |
| Latency p95 (cached board read) | < 150 ms |
| Latency p95 (writes) | < 400 ms |
| Job freshness (assignment email) | 95% within 60 s |
| Error rate (5xx) | < 0.1% |

Alert on **SLO burn rate**, not on single spikes (see §17).

---

## 13. Data Layer at Scale

### 13.1 Multi-tenancy model

- **Shared database, shared schema, `workspaceId` on every tenant-owned row** (already added to `Task`; add to `Column`, `Comment`, `Attachment`, `Tag` too).
- Benefits: cheap authorization (`WHERE workspaceId = $1`), natural **shard key** if you ever split the DB, and easy per-tenant export/delete.
- Every repository method takes `workspaceId` — **a query without it is a code-review blocker.**
- Optional defence-in-depth: **Postgres Row-Level Security**

```sql
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Task"
  USING ("workspaceId" = current_setting('app.workspace_id')::uuid);
-- per request, inside the transaction:
-- SELECT set_config('app.workspace_id', $1, true);
```

### 13.2 Optimistic concurrency (no lost updates)

Clients send the `version` they last saw (or `If-Match: "<version>"`). The update only succeeds if it still matches.

```ts
const { count } = await tx.task.updateMany({
  where: { id, version: input.version, deletedAt: null },
  data: { ...changes, version: { increment: 1 } },
});
if (count === 0) throw new AppError(409, 'VERSION_CONFLICT'); // client refetches & merges
```

Use it for task edits, board renames, and member-role changes. Return `409` with the latest entity to make client merges easy.

### 13.3 Connections & pooling

Postgres handles hundreds, not thousands, of connections. With N API replicas × pool size, you exhaust it quickly.

| Layer | Setting |
|---|---|
| Prisma pool (`connection_limit`) | 5–10 per replica; formula: `(DB max_connections − reserve) / replicas` |
| **PgBouncer** (transaction mode) | Between API/workers and Postgres; Neon/Supabase poolers do this for you |
| Prisma + PgBouncer | `?pgbouncer=true` in the URL; use a **direct** URL for migrations |
| Safety timeouts | `statement_timeout=5s`, `lock_timeout=2s`, `idle_in_transaction_session_timeout=10s` (set per role) |

> Timeouts stop one runaway query from holding locks and starving the pool.

### 13.4 Keeping tables bounded

| Table | Growth | Strategy |
|---|---|---|
| `ActivityLog` | Huge | **Range-partition by month**, keep N months hot, archive older partitions to object storage |
| `OutboxEvent` | Constant | Delete rows where `processedAt < now() - 7 days` (nightly job) |
| `RefreshToken` / `Invitation` / `IdempotencyKey` | Constant | Purge expired rows (nightly job, in batches) |
| `Notification` | Large | Retain 90 days; partition if needed |
| `Task` (soft-deleted) | Slow | Hard-purge after 30 days via job |

```sql
-- Partitioned activity log (raw SQL migration; Prisma doesn't model partitions)
CREATE TABLE activity_log (
  id uuid NOT NULL, workspace_id uuid NOT NULL, actor_id uuid NOT NULL,
  entity_type text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL,
  metadata jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
-- create monthly partitions automatically with pg_partman or a scheduled job
```

Also: tune **autovacuum** on hot tables, watch bloat, and always create big indexes with `CREATE INDEX CONCURRENTLY`.

### 13.5 Soft delete & retention

- `deletedAt` on tasks/users; every read path filters `deletedAt IS NULL` (centralise in the repository or a Prisma extension — never rely on memory).
- Partial indexes keep queries fast: `CREATE INDEX ... ON "Task"(...) WHERE "deletedAt" IS NULL;`
- Document retention periods in the README.

### 13.6 Don't ship the whole board

A board with 5,000 tasks must not return in one response.

- `GET /boards/:id` → board + columns + **task counts** + the **first N tasks per column** (e.g. 50).
- `GET /columns/:id/tasks?cursor=` → load more per column.
- Return **summary DTOs** (id, title, priority, due date, assignee avatars) — details load on `GET /tasks/:id`.
- Use Prisma `select` (never deep `include`) and watch for **N+1** (log query counts per request in dev).

### 13.7 Read replicas

- Route heavy, staleness-tolerant reads (activity feeds, search, reports) to a replica.
- Keep "read-your-own-writes" paths on the primary (e.g. right after create/update).
- Expect **replication lag**; never read a replica inside a flow that just wrote.

### 13.8 Zero-downtime migrations (expand → migrate → contract)

1. **Expand:** add new nullable column/table/index (backward compatible).
2. **Deploy** code that writes both old + new, reads new with fallback.
3. **Backfill** in small batches (job), not one giant `UPDATE`.
4. **Contract:** remove old column in a later release.

Never rename or drop a column in the same deploy that stops using it. Run `prisma migrate deploy` as a release step, before new pods take traffic.

---

## 14. Reliability Patterns

### 14.1 Idempotency keys

For non-idempotent `POST`s (create task, create comment, accept invitation), accept `Idempotency-Key: <uuid>`.

```ts
// middlewares/idempotency.ts (sketch)
export const idempotent = asyncHandler(async (req, res, next) => {
  const key = req.header('Idempotency-Key');
  if (!key) return next();
  const hash = sha256(JSON.stringify(req.body));
  const existing = await repo.find(req.user.id, key);
  if (existing) {
    if (existing.requestHash !== hash) throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED');
    if (existing.responseCode) return res.status(existing.responseCode).json(existing.responseBody);
    throw new AppError(409, 'REQUEST_IN_PROGRESS');
  }
  await repo.reserve(req.user.id, key, hash);      // unique (userId, key) prevents races
  res.on('finish', () => repo.complete(req.user.id, key, res.statusCode, captured));
  next();
});
```

### 14.2 Transactional outbox (guaranteed events)

**Problem:** commit succeeds → process crashes → email/socket/cache-invalidation never happens.
**Fix:** write an `OutboxEvent` row **in the same transaction** as the change. A relay publishes it.

```ts
await prisma.$transaction(async (tx) => {
  const task = await tx.task.update(/* … */);
  await activity.record(tx, /* … */);
  await tx.outboxEvent.create({
    data: { aggregate: 'task', aggregateId: task.id, type: 'task.assigned', payload },
  });
});
```

```ts
// jobs/outboxRelay.ts — runs in the worker process, every ~500 ms
const events = await prisma.$queryRaw<OutboxRow[]>`
  SELECT * FROM "OutboxEvent"
  WHERE "processedAt" IS NULL
  ORDER BY id
  LIMIT 100
  FOR UPDATE SKIP LOCKED`;               // safe with many relay instances
for (const e of events) {
  await dispatch(e);                      // enqueue BullMQ job / emit socket / invalidate cache
  await markProcessed(e.id);
}
```

- Delivery is **at-least-once** → consumers must be **idempotent** (use `jobId = event.id`).
- This replaces ad-hoc "emit after commit" for anything that must not be lost (assignment email, notification row, cache invalidation).

### 14.3 Timeouts, retries, circuit breakers, backpressure

| Concern | Rule |
|---|---|
| Outbound calls (email, S3, Google) | Always set a **timeout** (e.g. 3–5 s) |
| Retries | Only for idempotent calls, **exponential backoff + jitter**, capped attempts |
| Circuit breaker (`opossum`) | Open after repeated failures → fail fast, don't pile up requests |
| Request timeout | Global server timeout (e.g. 30 s) + per-route overrides |
| **Load shedding** | If event-loop lag > ~200 ms or queue depth huge → return `503` + `Retry-After` for non-critical routes |
| Graceful degradation | Redis down → bypass cache (read DB) with a breaker; **rate limiter fails open for reads, closed for auth** |

### 14.4 Redis separation

| Instance | Purpose | Eviction policy |
|---|---|---|
| `redis-cache` | Board cache, rate limits, socket adapter | `allkeys-lru` (eviction is fine) |
| `redis-queue` | BullMQ | **`noeviction`** (never lose jobs) + persistence (AOF) |

If you use one managed instance on a free tier, **document it as a known risk** and split at the first production milestone.

### 14.5 Dead-letter & poison jobs

- After max attempts, move jobs to a **failed set / DLQ** and alert.
- Add an admin-only endpoint or script to inspect + replay (Bull Board UI behind auth).
- Log `jobId`, `attemptsMade`, `reqId` for every failure.

---

## 15. Notifications, Realtime & Reminders at Scale

### 15.1 Persist notifications (realtime is only a delivery channel)

Flow: outbox event → worker creates `Notification` row → emits socket event to `user:{id}` → if user is offline, they see it on next load.

| Endpoint | Purpose |
|---|---|
| `GET /notifications?cursor=` | Paginated list |
| `GET /notifications/unread-count` | Cached counter (Redis `INCR`/`DECR`, reconcile periodically) |
| `POST /notifications/:id/read` · `POST /notifications/read-all` | Mark read |
| `GET/PUT /me/notification-preferences` | Email on/off, digest on/off *(stretch)* |

### 15.2 Socket.io at 20k+ connections

- **Redis adapter** (already planned); prefer **sharded adapter** for large fan-out.
- Tune OS/containers: raise `ulimit -n`, keep one process per core, ~5–10k sockets/process is a safe starting point.
- Heartbeats (`pingInterval`/`pingTimeout`) detect dead clients; clients reconnect with **exponential backoff + jitter** (avoid thundering herd after a deploy).
- **Missed-event recovery:** every event carries a monotonically increasing `eventId`/timestamp; on reconnect the client calls `GET /boards/:id/changes?since=…` to catch up. Sockets are *hints*, REST is the *truth*.
- **Authorization on every room join** and re-check on role removal (kick the user from rooms when removed from a workspace).
- Rate-limit inbound socket events.
- Alternative at higher scale: a managed realtime service (Ably/Pusher) or SSE for one-way notifications.

### 15.3 Time-zone-aware due-date reminders

A single "08:00 server time" job is wrong for a global user base.

1. Store `User.timezone` (IANA, e.g. `Asia/Kolkata`).
2. Run a repeatable job **every hour** (`0 * * * *`).
3. Query users whose **local time is 08:00 right now** (compute the set of tz names whose offset matches; `WHERE timezone = ANY($1)`).
4. For each user, find tasks due in the next 24h → build **one digest** per user.
5. **Fan out in chunks**: the hourly job enqueues N small "send-digest" jobs (e.g. 500 users each) instead of looping inline.
6. Idempotency: `jobId = digest:{userId}:{yyyy-mm-dd}` so retries/duplicate runs don't double-send.

### 15.4 Email deliverability & limits

- Use a transactional provider (SES, Resend, Postmark) — not raw SMTP — in production.
- Configure **SPF, DKIM, DMARC** on your sending domain.
- Include an **unsubscribe link** for reminder emails and honour preferences.
- Respect provider rate limits with a **BullMQ limiter** (`limiter: { max: 50, duration: 1000 }`).
- Handle **bounces/complaints** via provider webhooks → suppress bad addresses.

---

## 16. Security & Compliance Hardening

Part I covered the basics. Add:

**Authentication & sessions**

- [ ] **CSRF protection** for the cookie-based refresh endpoint (`SameSite=Strict`, plus a custom header requirement or double-submit token).
- [ ] **JWT key rotation** using `kid` headers and a JWKS-style key set; support two active keys during rotation.
- [ ] **Account lockout / progressive delay** after repeated failures (per account *and* per IP).
- [ ] Password policy: min length, check against breached-password list (HIBP k-anonymity API) — *stretch*.
- [ ] **MFA (TOTP)** — *stretch*; "log out all devices" endpoint; session list with revoke.
- [ ] argon2 parameters tuned (memory 19–64 MiB, time 2–3) and benchmarked (see §18).

**Application security**

- [ ] **IDOR/tenant-isolation test suite** — automatically try every endpoint with another tenant's IDs.
- [ ] **Mass-assignment protection:** Zod schemas use `.strict()` so unknown fields (`role`, `workspaceId`) are rejected.
- [ ] **SSRF** — never fetch user-supplied URLs server-side (avatars, webhooks) without an allow-list + private-IP blocking.
- [ ] **Uploads:** serve with `Content-Disposition: attachment` for non-images, separate cookieless domain for user files, optional malware scan (ClamAV worker), strip image EXIF.
- [ ] **Security headers:** `helmet` + strict **CSP** for the docs page; HSTS at the edge.
- [ ] **Input limits:** body size, array lengths (max assignees/tags per task), string lengths, query `limit` caps.
- [ ] **ReDoS-safe** validation (avoid catastrophic regex).

**Infrastructure & supply chain**

- [ ] Secrets in a **secrets manager** (host secret store / Doppler / AWS SM) — never in git, never in logs.
- [ ] **Least-privilege** DB user for the app (no `SUPERUSER`, separate migration user) and **scoped IAM keys** for S3/R2.
- [ ] **Dependabot/Renovate**, `npm audit --omit=dev` in CI, **CodeQL**, container scan (**Trivy**), lockfile committed, pin base-image digests.
- [ ] Encryption **in transit** (TLS to DB/Redis) and **at rest** (managed disks/buckets).
- [ ] Run containers as non-root, read-only filesystem where possible.

**Privacy & compliance (GDPR-style)**

- [ ] `GET /me/export` — data export job (async, emailed link).
- [ ] `DELETE /me` — account deletion workflow (soft delete → anonymise comments/activity → hard purge after retention).
- [ ] **PII inventory**; redact PII in logs; don't put emails in URLs.
- [ ] Immutable **audit trail** for permission changes (separate from activity log; append-only).
- [ ] Documented data retention + backup retention periods.

---

## 17. Observability at Scale

Logs tell you *what happened*; metrics and traces tell you *why it's slow* and *whether you're healthy*.

**Metrics (Prometheus format via `prom-client`, or your host's metrics)**

| Type | Examples |
|---|---|
| RED (per route) | Rate, Errors, Duration histograms (p50/p95/p99) |
| Runtime | Event-loop lag, heap used, GC pause, open handles, active sockets |
| Database | Pool in-use/waiting, slow-query count, replication lag |
| Redis/cache | Hit ratio, command latency, memory, evictions |
| Queues | Waiting, active, failed, **oldest job age**, processing time |
| Business | Signups/min, tasks created/min, emails sent, websocket connects |

**Tracing — OpenTelemetry**

- Auto-instrument HTTP, Postgres/Prisma, Redis, BullMQ.
- **Propagate the request ID / trace ID into queue jobs** (put it in job data) so one trace spans API → outbox → worker → email.

**Alerting (page only on user-visible symptoms)**

| Alert | Condition |
|---|---|
| SLO burn | 5xx > 1% for 5 min **or** fast/slow burn-rate alerts |
| Latency | p95 > SLO for 10 min |
| Queue health | Oldest job age > 5 min; DLQ growth |
| Saturation | DB pool waiting > 0 for 2 min; event-loop lag > 200 ms; CPU > 80% |
| Dependency | Redis/DB unreachable; `/ready` failing |
| Security | Spike in 401/403/429 on auth routes |

**Hygiene**

- Sample Sentry traces (e.g. 5–10%) and set release + environment tags.
- Log **levels** by environment; sample noisy `info` logs under heavy load; ship logs to a central store with retention (e.g. 14–30 days).
- External **uptime/synthetic checks** (hit `/health` and a login+read flow every minute from outside).
- Dashboards: one **overview** (RED + saturation) and one per subsystem (DB, Redis, queues, sockets).
- Write a short **runbook** per alert: what it means, first 3 things to check, how to mitigate.

---

## 18. Node.js Performance Tuning

| Risk | Mitigation |
|---|---|
| **Event-loop blocking** | Never run CPU-heavy work on the main thread; use worker threads/queue for exports, image processing, large JSON transforms |
| **argon2/bcrypt cost** | Hashing uses the libuv threadpool; set `UV_THREADPOOL_SIZE` (e.g. 8–16) and rate-limit login so hashing can't starve the pool |
| **Keep-alive mismatch** | Set `server.keepAliveTimeout` **greater than** the load balancer's idle timeout (e.g. 65 s vs 60 s) and `headersTimeout` slightly higher — prevents random `502`s |
| **Memory** | Set container memory limits and `--max-old-space-size` ≈ 75% of limit; alert on heap growth (leak detection) |
| **Scaling per box** | One Node process per CPU core (containers or `cluster`); don't give one process 8 cores |
| **Large responses** | Paginate; **stream** exports (CSV) instead of buffering; gzip/brotli at the proxy/CDN |
| **Conditional requests** | ETag + `If-None-Match` on board/task reads → `304` saves bandwidth and CPU |
| **JSON cost** | Return summary DTOs; avoid serialising huge objects; consider `fast-json-stringify` (built into Fastify) on hot routes |
| **Prisma** | `select` only needed fields; batch with `findMany`/`in`; avoid loops of queries; use `$queryRaw` for complex hot paths |
| **Unhandled errors** | Log + exit on `uncaughtException` after flushing, let the orchestrator restart |
| **Keep process lean** | Lazy-load rarely used modules; don't load Swagger/OpenAPI generator in worker process |

---

## 19. Load Testing & Chaos

**Tool:** [k6](https://k6.io) (free). Run against a **staging** environment sized like production.

**Test types**

| Test | Goal | Example |
|---|---|---|
| Smoke | Script works | 1 VU, 1 min |
| **Load** | Meets SLO at expected peak | ramp to 1,200 RPS mix: 90% reads / 10% writes |
| **Stress** | Find the breaking point | keep ramping until errors > 1% |
| **Spike** | Sudden surge (marketing email) | 0 → 5× in 30 s |
| **Soak** | Leaks, bloat | steady load for 2–4 h |
| WebSocket | Connection capacity | ramp to 20k sockets with periodic events |

```js
// k6 sketch
export const options = {
  scenarios: {
    reads:  { executor: 'ramping-arrival-rate', startRate: 50, timeUnit: '1s',
              preAllocatedVUs: 200, stages: [{ target: 1000, duration: '5m' }, { target: 1000, duration: '10m' }],
              exec: 'readBoard' },
    writes: { executor: 'constant-arrival-rate', rate: 100, timeUnit: '1s', duration: '15m',
              preAllocatedVUs: 100, exec: 'createTask' },
  },
  thresholds: { http_req_failed: ['rate<0.001'], http_req_duration: ['p(95)<400'] },
};
```

**Make the data realistic:** write a seed script that generates **millions of tasks and tens of millions of activity rows** — queries that are fast on 1,000 rows often collapse at 50M. Re-run `EXPLAIN ANALYZE` on the filter/pagination queries with that data.

**What to watch while testing:** DB CPU + pool waits, slow query log, Redis hit ratio, event-loop lag, queue age, p95/p99, error rate.

**Chaos drills (staging)**

- Kill Redis → app should degrade, not crash.
- Restart the DB / force failover → pool recovers, no stuck requests.
- Stop workers for 10 min → queues back up, then drain without duplicate emails.
- Deploy during load → no 502 spike (validates graceful shutdown + keep-alive).

Add a short **nightly perf check** in CI (small k6 run) to catch regressions, and record results in `docs/performance.md`.

---

## 20. Delivery & Operations

### 20.1 Environments

| Env | Purpose | Data |
|---|---|---|
| `local` | Docker Compose | Seed data |
| `test` (CI) | Ephemeral containers | Factories |
| `staging` | Prod-like, load tests, previews | Synthetic/anonymised |
| `production` | Users | Real |

### 20.2 Deployment strategy

- **Rolling or blue-green** with health/readiness gates; never recreate-all.
- Graceful shutdown + `preStop` delay so the LB stops routing before SIGTERM closes the server.
- **Automated rollback** on failed health check; keep previous image tagged by git SHA.
- **Feature flags** (even a simple DB/env flag table) to ship dark and enable gradually.
- Migrations run before rollout, always backward compatible (§13.8).

### 20.3 Backup & disaster recovery

| Item | Target |
|---|---|
| Postgres | Automated daily backups **+ PITR (WAL)**; define **RPO ≤ 5 min**, **RTO ≤ 1 h** |
| Object storage | Versioning enabled; lifecycle rules |
| Redis queue | AOF persistence |
| **Restore drill** | Actually restore a backup into staging each quarter — untested backups aren't backups |

### 20.4 Infrastructure as code & config

- Keep infra definitions in the repo (`render.yaml` / `fly.toml` / Terraform) — environments are reproducible.
- One Docker image, config via env; same artefact promoted staging → prod.

### 20.5 Engineering process

- `CONTRIBUTING.md`, PR template (checklist: tests, docs, migration safe, indexes, security), `CODEOWNERS`.
- **ADRs** (`docs/adr/0001-postgres-over-mongo.md`) for each major decision — this *is* your "design decisions and trade-offs" section.
- Conventional commits + automated changelog/semantic-release.
- Branch protection: required CI, required review, no force-push to `main`.
- Incident template + post-mortem doc (even for a solo project, include one example).

---

## 21. API Design Standards

| Area | Standard |
|---|---|
| **Versioning** | `/api/v1/...`; breaking changes → `/v2`; use `Deprecation`/`Sunset` headers |
| **Errors** | `{ error: { code, message, details?, requestId } }`; stable machine-readable `code`s; map to correct HTTP status (400/401/403/404/409/422/429) |
| **Pagination** | `?limit=&cursor=` → `{ data, meta: { nextCursor, hasNext } }`; enforce max `limit` (e.g. 100) |
| **Filtering/sorting** | Whitelisted fields only; documented in OpenAPI |
| **Idempotency** | `Idempotency-Key` on creates (§14.1) |
| **Concurrency** | `ETag` / `If-Match` or `version` field → `409`/`412` |
| **Rate-limit headers** | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` on 429 |
| **Caching** | `ETag` + `Cache-Control: private, no-cache` on user-specific reads |
| **Bulk operations** | `POST /tasks/bulk` (cap 100 items) for moves/status changes — avoids request storms |
| **Request IDs** | Accept inbound `X-Request-Id`, always return one |
| **Timestamps** | ISO-8601 UTC everywhere; store `timestamptz` |
| **IDs** | UUID/ULID strings; never expose auto-increment IDs |
| **Health** | `/health` (liveness), `/ready` (readiness), both unauthenticated and cheap |
| **Webhooks (stretch)** | Outbound webhooks signed with HMAC, retried with backoff, delivered from the outbox |

---

## 22. Scale-Up Roadmap

What to change as real traffic arrives — **don't build stage 3 on day 1, but make sure stage 1 doesn't block it.**

| Stage | Users | Architecture | Key moves |
|---|---|---|---|
| **1 — Launch** | 0 – 10k | 2 API replicas, 1 worker, 1 Postgres (managed, pooled), 1 Redis | This guide's Part I + §13–§17 basics |
| **2 — Growth** | 10k – 200k | 4–8 API replicas, 2–4 workers, PgBouncer, **separate cache/queue Redis**, read replica, CDN for files | Outbox relay, partitioned `ActivityLog`, load-test in CI, autoscaling, alerting/SLOs |
| **3 — Scale** | 200k – 1M+ | Autoscaled API + dedicated **realtime service**, worker pools per queue, bigger primary + 1–2 replicas | Extract notifications/search, dedicated search engine, sharded socket adapter, multi-AZ + DR drills |
| **4 — Hyperscale** | 1M+ heavy | Multi-region reads, tenant sharding by `workspaceId`, event streaming (Kafka/Redpanda) | Only if metrics prove the need |

**Free-tier reality check:** Render/Railway/Fly + Neon/Supabase + Upstash free plans are perfect for the capstone and demos but have cold starts, connection limits, and no SLA. In the README, state clearly *"deployed on free tiers; here is what changes for production"* and link this table — reviewers value that honesty.

---

## 23. Updated Final Checklist

**Data & scale**
- [ ] Capacity assumptions + SLOs documented
- [ ] `workspaceId` on all tenant rows; tenant-isolation tests (optionally RLS)
- [ ] Optimistic concurrency (`version`) on tasks → `409` handling
- [ ] PgBouncer/pooler configured; DB timeouts set
- [ ] `ActivityLog` partitioned; purge jobs for tokens/outbox/idempotency keys
- [ ] Soft delete + retention policy
- [ ] Board reads return summaries + per-column pagination
- [ ] Zero-downtime migration practice (expand/contract)
- [ ] `EXPLAIN ANALYZE` results on large seeded data in `docs/performance.md`

**Reliability**
- [ ] Idempotency keys on creates
- [ ] Transactional outbox + relay (`SKIP LOCKED`), idempotent consumers
- [ ] Timeouts, retries with jitter, circuit breakers on external calls
- [ ] Separate cache vs queue Redis (or documented risk)
- [ ] DLQ + replay tooling; load shedding on event-loop lag

**Realtime & jobs**
- [ ] Persisted notifications + unread count + read endpoints
- [ ] Socket reconnect with backoff, catch-up via `since`, room re-authorization
- [ ] Time-zone-aware hourly reminder fan-out in chunks
- [ ] Email provider with SPF/DKIM/DMARC, unsubscribe, bounce handling

**Security & compliance**
- [ ] CSRF on cookie endpoints, JWT key rotation, lockout, strict Zod schemas
- [ ] SSRF/upload hardening, CSP/HSTS, dependency + container scanning in CI
- [ ] Least-privilege DB/IAM, secrets manager
- [ ] Data export + account deletion flows; audit trail for permission changes

**Observability & ops**
- [ ] RED + runtime + DB + queue metrics; OpenTelemetry traces across API → worker
- [ ] SLO-based alerts + runbooks; external uptime checks
- [ ] Backups with PITR **and a tested restore**
- [ ] Rolling/blue-green deploy, automated rollback, feature flags
- [ ] k6 load/stress/spike/soak results recorded; chaos drills done
- [ ] ADRs, CONTRIBUTING, PR template, CODEOWNERS
- [ ] API versioning, rate-limit headers, ETags, bulk endpoints

**Definition of Done (unchanged, now with proof)**
1. `git clone` → `docker compose up` → app + worker healthy
2. `npm test` green with ≥ 70% coverage on core modules
3. Live HTTPS URL + `/docs` reachable
4. `docs/performance.md` shows measured p95 at target load and the scale-up plan

> **Senior-dev closing rule:** *measure first, optimise second, and never add a distributed-systems pattern you can't explain, monitor, and test.* Build Part I fully, then layer Part II in the order the load tests tell you to.
