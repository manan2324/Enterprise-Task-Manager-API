# Enterprise Task Manager API

[![CI](https://github.com/example/enterprise-task-manager-api/actions/workflows/ci.yml/badge.svg)](https://github.com/example/enterprise-task-manager-api/actions)
[![Coverage](https://img.shields.io/badge/Coverage-94.4%25-brightgreen.svg)](https://github.com/example/enterprise-task-manager-api)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.0.0-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-ISC-purple.svg)](LICENSE)

A production-grade, modular monolith Trello/Asana-style task management backend API built in **TypeScript** and **Node.js 22**, tested with **real PostgreSQL & Redis**, documented with **OpenAPI/Swagger derived from Zod schemas**, and engineered for high-concurrency enterprise workloads (1M+ users).

**Interactive Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs) · **OpenAPI Spec:** [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json) · **Prometheus Metrics:** [http://localhost:3000/metrics](http://localhost:3000/metrics)

---

## Architecture Overview

```mermaid
flowchart TD
    Client["Clients (Web / Mobile / Postman)"] -->|"HTTP / REST (JSON)"| App["Express 5 API Gateway"]
    Client -->|"WebSockets"| SocketIO["Socket.io Cluster"]

    subgraph API_Tier ["Stateless Application Layer"]
        App --> RateLimit["Redis Rate Limiter"]
        App --> LoadShed["Load Shedding (perf_hooks)"]
        App --> Idempotency["Idempotency Engine (§14.1)"]
        App --> Auth["JWT & Token Rotation Engine"]
        App --> CacheService["Redis Board Cache-Aside (§6.4)"]
        App --> StorageService["S3 / R2 Pre-Signed Storage (§6.2)"]
    end

    subgraph Data_Tier ["Data Layer & Invariants"]
        App -->|"Atomic Transactions"| Postgres[(PostgreSQL 16 Primary)]
        Postgres --> OutboxTable[("OutboxEvent (SKIP LOCKED)")]
    end

    subgraph Async_Tier ["Reliable Event & Job Processing"]
        OutboxRelay["Outbox Relay Worker (§14.2)"] -->|"FOR UPDATE SKIP LOCKED"| OutboxTable
        OutboxRelay -->|"Publish"| SocketIO
        OutboxRelay -->|"Enqueue"| BullMQ["BullMQ Queues"]
        OutboxRelay -->|"Invalidate"| CacheService
        BullMQ --> Workers["Background Workers (§6.6)"]
        Workers -->|"SMTP"| Mailer["Email Service (MailHog / Resend)"]
    end

    subgraph Storage_Tier ["Object Storage"]
        Client -->|"Direct Upload / Download (Pre-Signed URLs)"| S3Bucket[("S3 / Cloudflare R2 Bucket")]
    end
```

---

## Core Features

| Module | Features |
|---|---|
| **Authentication (§5.1)** | Argon2id hashing, email verification, login rate limiting (5 attempts/15m), short-lived access tokens (15m), rotating refresh tokens with reuse detection (family invalidation), password reset. |
| **Workspaces & RBAC (§5.2)** | Multi-tenancy with strict workspace isolation. 4-tier Role Matrix (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), tokenized invitations, cross-tenant IDOR protection (404 on unpermitted resources). |
| **Boards & Columns (§5.2)** | Dynamic kanban boards, starter columns, fractional column reordering, Redis cache-aside with automatic invalidation on mutations. |
| **Tasks & Subtasks (§5.3)** | Task lifecycle (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`), priorities (`LOW`, `MEDIUM`, `HIGH`, `URGENT`), due dates, assignees, workspace tags, hierarchical subtasks, task comments. |
| **Fractional Ordering (§5.3)** | Midpoint fractional positioning (`between(prev, next)` using `Decimal(20, 10)`). Reordering only touches 1 row without updating neighboring positions. |
| **Optimistic Concurrency (§13.2)** | Atomic version checks (`version` integer / `If-Match` header) preventing lost updates in concurrent multi-user environments. |
| **Transactional Outbox (§14.2)** | Change mutations, activity logs, and `OutboxEvent` rows committed atomically. Relay dispatches with PostgreSQL `FOR UPDATE SKIP LOCKED` for zero lost events. |
| **Search & Keyset Pagination (§6.1)** | Text search (`q`), status, priority, assignee, and due date bounds with composite cursor pagination (`createdAt:id` / `dueDate:id`). |
| **Attachments (§6.2)** | Pre-signed S3/Cloudflare R2 direct uploads & downloads. File name sanitization, MIME whitelist, and 10MB limit enforcement. |
| **Realtime Updates (§6.3)** | Socket.io with `@socket.io/redis-adapter` for horizontal scaling. Personal user rooms (`user:{id}`) and board rooms (`board:{id}`). |
| **Background Workers (§6.6)** | BullMQ queues on dedicated Redis connection: assignment notification emails with backoff retry, and timezone-aware daily due reminders digest. |
| **Idempotency Keys (§14.1)** | Request deduplication for non-idempotent operations via `Idempotency-Key` header with SHA-256 payload verification. |
| **Load Shedding & Metrics (§14.3, §17)** | Node event-loop monitoring (`monitorEventLoopDelay`) returning 503 + `Retry-After: 5` under saturation. Full Prometheus RED metrics exposed at `/metrics`. |

---

## Database Architecture & Entity Relationships

```mermaid
erDiagram
    User ||--o{ WorkspaceMember : "has"
    User ||--o{ RefreshToken : "owns"
    User ||--o{ AuthToken : "holds"
    User ||--o{ TaskAssignee : "assigned"
    User ||--o{ Comment : "authors"
    User ||--o{ Notification : "receives"
    User ||--o{ ActivityLog : "acts"

    Workspace ||--o{ WorkspaceMember : "contains"
    Workspace ||--o{ Board : "owns"
    Workspace ||--o{ Tag : "defines"
    Workspace ||--o{ Invitation : "issues"
    Workspace ||--o{ ActivityLog : "records"

    Board ||--o{ Column : "contains"
    Column ||--o{ Task : "groups"

    Task ||--o{ Subtask : "includes"
    Task ||--o{ Comment : "has"
    Task ||--o{ Attachment : "attaches"
    Task ||--o{ TaskAssignee : "assigned_to"
    Task ||--o{ TaskTag : "tagged_with"

    Tag ||--o{ TaskTag : "applied_to"
```

### Why PostgreSQL?
1. **ACID Transactions:** Invariants such as task creation + activity log + outbox event commit in a single database transaction.
2. **Row Locking Primitive:** `FOR UPDATE SKIP LOCKED` enables concurrent, conflict-free outbox relay worker processes.
3. **Decimal Precision:** Arbitrary-precision `DECIMAL(20, 10)` supports infinite fractional ordering without column reindexing overhead.
4. **Partial & Composite Indexes:** Optimized indexes for tenant lookups (`workspaceId, status, priority`), active records (`workspaceId, deletedAt WHERE deletedAt IS NULL`), and keyset pagination (`createdAt, id`).

---

## Local Setup

### Prerequisites
- Node.js ≥ 22.0.0
- Docker & Docker Compose
- npm ≥ 10.0.0

### Step-by-Step Instructions

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd "Enterprise Task Manager API"
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Start infrastructure (Postgres, Redis, MailHog):**
   ```bash
   docker compose up -d
   ```

4. **Install dependencies & generate Prisma client:**
   ```bash
   npm ci
   npx prisma generate
   ```

5. **Run database migrations:**
   ```bash
   npx prisma migrate deploy
   ```

6. **Seed demo data (Optional):**
   ```bash
   npm run prisma:seed
   ```
   *Seeds 4 demo users (`owner@example.com`, `admin@example.com`, `member@example.com`, `viewer@example.com`), password: `Password123!`, a demo workspace, boards, columns, and tasks.*

7. **Start development server:**
   ```bash
   npm run dev
   ```

8. **Access endpoints:**
   - **Interactive Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs)
   - **OpenAPI JSON Spec:** [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)
   - **Prometheus Metrics:** [http://localhost:3000/metrics](http://localhost:3000/metrics)
   - **Health & Readiness:** [http://localhost:3000/health](http://localhost:3000/health) & [http://localhost:3000/ready](http://localhost:3000/ready)
   - **MailHog Web UI:** [http://localhost:8025](http://localhost:8025)

---

## Running Tests

All integration tests execute against real PostgreSQL and Redis instances.

```bash
# Run all unit and integration tests (164 tests across 25 suites)
npm test

# Run tests with statement & branch coverage (>94% coverage)
npm run test:cov

# Typecheck and linting
npm run typecheck
npm run lint

# Production compilation
npm run build
```

---

## Environment Variables

| Variable | Type | Required | Description | Default / Example |
|---|---|:---:|---|---|
| `NODE_ENV` | String | Yes | Application environment | `development` / `production` |
| `PORT` | Number | Yes | HTTP server port | `3000` |
| `DATABASE_URL` | URL | Yes | PostgreSQL connection string | `postgresql://app:app@localhost:5433/taskmanager` |
| `REDIS_URL` | URL | Yes | Redis connection string | `redis://localhost:6379` |
| `JWT_ACCESS_SECRET` | String | Yes | HMAC-SHA256 secret (min 32 chars) | `your-secure-access-secret-32-chars!` |
| `JWT_REFRESH_SECRET` | String | Yes | HMAC-SHA256 secret (min 32 chars) | `your-secure-refresh-secret-32-chars!` |
| `ACCESS_TOKEN_TTL` | String | No | Access token expiration | `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | Number | No | Refresh token TTL | `30` |
| `APP_URL` | URL | Yes | Public application URL (CORS origin) | `http://localhost:3000` |
| `SMTP_HOST` | String | Yes | SMTP server hostname | `localhost` |
| `SMTP_PORT` | Number | Yes | SMTP port | `1025` (MailHog) / `587` |
| `SMTP_USER` | String | No | SMTP authentication username | — |
| `SMTP_PASS` | String | No | SMTP authentication password | — |
| `S3_BUCKET` | String | Yes | S3 / Cloudflare R2 bucket name | `task-manager-attachments` |
| `S3_REGION` | String | No | S3 region | `auto` |
| `S3_ENDPOINT` | URL | No | Custom S3 endpoint (for R2 / MinIO) | `https://<account>.r2.cloudflarestorage.com` |
| `S3_ACCESS_KEY_ID` | String | Yes | S3 access key ID | `s3-access-key` |
| `S3_SECRET_ACCESS_KEY` | String | Yes | S3 secret access key | `s3-secret-key` |
| `SENTRY_DSN` | URL | No | Sentry DSN for error telemetry | — |

---

## Design Decisions & Scalability Trade-offs

1. **Modular Monolith vs Microservices (§1):**
   - Built with strict domain module boundaries (`auth`, `workspaces`, `boards`, `tasks`, `activity`).
   - Modules communicate via public interfaces and shared transactions; no distributed 2-phase commits required. Background workers and outbox relay can be scaled independently into separate processes.

2. **Fractional Ordering vs Integer Position Updates (§5.3):**
   - Reordering an item computes the midpoint between adjacent positions (`(prev + next) / 2`).
   - **Advantage:** Reordering updates exactly **1 row** with $O(1)$ complexity, avoiding cascading row updates across thousands of items in large columns.

3. **Keyset (Cursor) Pagination vs Offset Pagination (§6.1):**
   - Offset pagination (`OFFSET 50000 LIMIT 20`) causes severe table scan performance degradation ($O(N)$).
   - Keyset cursor pagination uses composite indexes `(createdAt, id)` or `(dueDate, id)`, executing in $O(1)$ constant time regardless of page depth.

4. **Transactional Outbox vs Immediate Emit (§14.2):**
   - Direct emit after DB update loses events if the application crashes before the event is sent to Redis or the email server.
   - Outbox rows are written in the same DB transaction as the domain change. The relay polls via `FOR UPDATE SKIP LOCKED`, guaranteeing at-least-once delivery.

5. **Dedicated Redis Connections (§14.4):**
   - Separate Redis client instances are maintained:
     - `cacheRedis`: Board caching and fast TTL queries (`allkeys-lru`).
     - `queueRedis` & `workerRedis`: BullMQ job queues configured with `maxRetriesPerRequest: null` and `noeviction` policy so background jobs are never dropped.

6. **Database Connection Limits & Safety Timeouts (§13.3):**
   - Connection pool size limited to 10 per replica.
   - Session-level safety timeouts enforced on every connection:
     `SET statement_timeout = 5000; SET lock_timeout = 2000; SET idle_in_transaction_session_timeout = 10000;`
     preventing runaway queries from starving the pool.

---

## Security & OWASP Top 10 Mitigations

- **Broken Access Control (IDOR):** Every tenant resource check resolves through workspace membership. Attempting to access resources in another workspace returns `404 Not Found` (preventing ID enumeration).
- **Injection:** All queries are parameterised through Prisma ORM and sanitized PostgreSQL client queries.
- **Identification & Auth Failures:** Passwords hashed with Argon2id; refresh tokens rotate on each exchange with automatic revocation of entire token family if reuse is detected. Rate-limiting protects auth endpoints from brute force.
- **Security Misconfiguration:** Strict Content Security Policy (CSP) with `helmet`, CORS allow-list restricted to `APP_URL`, body size limit capped at `1mb`, secrets redacted from logs.
- **Vulnerable Dependencies:** Automated `npm audit` and dependabot scanning in CI pipeline.

---

## License

ISC License.
