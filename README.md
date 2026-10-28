# Enterprise Task Manager API

[![CI](https://github.com/example/enterprise-task-manager-api/actions/workflows/ci.yml/badge.svg)](https://github.com/example/enterprise-task-manager-api/actions)
[![Coverage](https://img.shields.io/badge/Coverage-94.4%25-brightgreen.svg)](https://github.com/example/enterprise-task-manager-api)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.0.0-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-ISC-purple.svg)](LICENSE)

A production-grade, modular monolith Trello/Asana-style task management backend API built in **TypeScript** and **Node.js 22**, tested with **real PostgreSQL & Redis**, documented with **OpenAPI/Swagger derived from Zod schemas**, and engineered for high-concurrency enterprise workloads (1M+ users).

**Live API:** `https://taskmanager-api.onrender.com` · **API Docs:** `https://taskmanager-api.onrender.com/docs` · **OpenAPI Spec:** `https://taskmanager-api.onrender.com/openapi.json` · **Prometheus Metrics:** `https://taskmanager-api.onrender.com/metrics`

*(Local endpoints: [http://localhost:3000/docs](http://localhost:3000/docs) · [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json) · [http://localhost:3000/metrics](http://localhost:3000/metrics))*

---

## Features

- **Authentication (§5.1):** Argon2id hashing, email verification, login rate limiting (5 attempts/15m), short-lived access tokens (15m), rotating refresh tokens with reuse detection (family invalidation), password reset.
- **Workspaces & RBAC (§5.2):** Strict multi-tenant workspace isolation. 4-tier Role Matrix (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), tokenized invitations, cross-tenant IDOR protection (404 on unpermitted resources).
- **Boards & Columns (§5.2):** Dynamic kanban boards, starter columns, fractional column reordering, Redis cache-aside with automatic invalidation on mutations.
- **Tasks & Subtasks (§5.3):** Task lifecycle (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`), priorities (`LOW`, `MEDIUM`, `HIGH`, `URGENT`), due dates, assignees, workspace tags, hierarchical subtasks, task comments.
- **Fractional Ordering (§5.3):** Midpoint fractional positioning (`between(prev, next)` using `Decimal(20, 10)`). Reordering only touches 1 row without updating neighboring positions.
- **Optimistic Concurrency (§13.2):** Atomic version checks (`version` integer / `If-Match` header) preventing lost updates in concurrent multi-user environments.
- **Transactional Outbox (§14.2):** Change mutations, activity logs, and `OutboxEvent` rows committed atomically. Relay dispatches with PostgreSQL `FOR UPDATE SKIP LOCKED` for zero lost events.
- **Search & Keyset Pagination (§6.1):** Text search (`q`), status, priority, assignee, and due date bounds with composite cursor pagination (`createdAt:id` / `dueDate:id`).
- **Attachments (§6.2):** Pre-signed S3/Cloudflare R2 direct uploads & downloads. File name sanitization, MIME whitelist, and 10MB limit enforcement.
- **Realtime Updates (§6.3):** Socket.io with `@socket.io/redis-adapter` for horizontal scaling. Personal user rooms (`user:{id}`) and board rooms (`board:{id}`).
- **Background Workers (§6.6):** BullMQ queues on dedicated Redis connection: assignment notification emails with backoff retry, and timezone-aware daily due reminders digest.
- **Idempotency Keys (§14.1):** Request deduplication for non-idempotent operations via `Idempotency-Key` header with SHA-256 payload verification.
- **Load Shedding & Metrics (§14.3, §17):** Node event-loop monitoring (`monitorEventLoopDelay`) returning 503 + `Retry-After: 5` under saturation. Full Prometheus RED metrics exposed at `/metrics`.

---

## Architecture

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

### Module Boundaries & Request Flow
1. **Edge Validation:** Incoming requests pass through security headers (`helmet`), strict CORS, body size limit (`1mb`), request ID generation (`requestId`), load shedding, and Zod validation middleware.
2. **Controller & Service Layer:** Thin controllers invoke fat services that execute domain rules and coordinate database transactions.
3. **Database & Outbox Invariants:** Domain changes, activity log entries, and `OutboxEvent` records are written atomically in a single Prisma transaction.
4. **Relay & Workers:** The outbox relay reads pending events using `FOR UPDATE SKIP LOCKED` and fans out notifications to Socket.io, BullMQ job queues, and the Redis cache without blocking user requests.
5. **Storage:** Large file transfers bypass the API server entirely via short-lived pre-signed S3/R2 upload and download URLs.

---

## Database

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
- **ACID Transactions:** Invariants such as task creation + activity log + outbox event commit in a single database transaction.
- **Row Locking Primitives:** `FOR UPDATE SKIP LOCKED` enables concurrent, conflict-free outbox relay worker processes across multiple container replicas.
- **Decimal Precision:** Arbitrary-precision `DECIMAL(20, 10)` supports infinite fractional ordering without column reindexing overhead.
- **Partial & Composite Indexes:** Optimized indexes for tenant lookups (`workspaceId, status, priority`), active records (`workspaceId, deletedAt WHERE deletedAt IS NULL`), and keyset pagination (`createdAt, id`).

### Notable Indexes
- `Task(columnId, position)`: Fast ordering scans within a column.
- `Task(workspaceId, status, priority)`: Filtered workspace task queries.
- `Task(workspaceId, deletedAt)`: Soft deletion partial query filter.
- `Task(createdAt, id)` & `Task(dueDate)`: Fast cursor pagination without full table scans.
- `OutboxEvent(processedAt, id)`: Outbox relay worker queue polling.
- `IdempotencyKey(userId, key)`: Fast composite lookups for request deduplication.

---

## Local Setup

1. **Clone repository and configure environment:**
   ```bash
   git clone <repo-url> && cd "Enterprise Task Manager API"
   cp .env.example .env
   ```

2. **Start Docker infrastructure:**
   ```bash
   docker compose up -d
   ```
   *Spins up PostgreSQL 16 (port 5433), Redis 7 (port 6379), and MailHog SMTP/Web UI (ports 1025/8025).*

3. **Install dependencies and migrate database:**
   ```bash
   npm ci
   npx prisma generate
   npx prisma migrate deploy
   ```

4. **Seed demo data (Optional):**
   ```bash
   npm run prisma:seed
   ```
   *Seeds 4 demo users (`owner@example.com`, `admin@example.com`, `member@example.com`, `viewer@example.com` / password: `Password123!`), a sample workspace, kanban boards, columns, and tasks.*

5. **Start development API server:**
   ```bash
   npm run dev
   ```
   *Open [http://localhost:3000/docs](http://localhost:3000/docs) (MailHog UI: [http://localhost:8025](http://localhost:8025)).*

6. **Start background worker process (in a separate terminal):**
   ```bash
   npm run worker:dev
   ```

---

## Running Tests

All unit and integration tests execute against real PostgreSQL and Redis instances.

```bash
# Run all unit and integration tests (164 tests across 25 suites)
npm test

# Run tests with statement & branch coverage (>94% coverage)
npm run test:cov

# Typecheck and linting
npm run typecheck
npm run lint

# Production build compilation
npm run build
```

---

## Environment Variables

| Variable | Required | Description | Example / Default |
|---|:---:|---|---|
| `NODE_ENV` | Yes | Application environment mode | `development` / `production` / `test` |
| `PORT` | Yes | HTTP server listen port | `3000` |
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://app:app@localhost:5433/taskmanager` |
| `REDIS_URL` | Yes | Redis connection string | `redis://localhost:6379` |
| `JWT_ACCESS_SECRET` | Yes | HMAC-SHA256 secret for access tokens (min 32 chars) | `your-secure-access-secret-32-chars!` |
| `JWT_REFRESH_SECRET` | Yes | HMAC-SHA256 secret for refresh tokens (min 32 chars) | `your-secure-refresh-secret-32-chars!` |
| `ACCESS_TOKEN_TTL` | No | Lifespan of JWT access token | `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | No | Lifespan of rotating refresh token | `30` |
| `APP_URL` | Yes | Client web origin for CORS allowlist | `http://localhost:3000` |
| `SMTP_HOST` | Yes | Outbound mail server hostname | `localhost` / `smtp.resend.com` |
| `SMTP_PORT` | Yes | Outbound mail server port | `1025` (MailHog) / `587` |
| `SMTP_USER` | No | SMTP authentication username | — |
| `SMTP_PASS` | No | SMTP authentication password | — |
| `S3_BUCKET` | Yes | S3 or Cloudflare R2 bucket name | `task-manager-attachments` |
| `S3_REGION` | No | AWS/R2 bucket region | `auto` / `us-east-1` |
| `S3_ENDPOINT` | No | Custom S3 endpoint (for R2, MinIO, LocalStack) | `https://<account>.r2.cloudflarestorage.com` |
| `S3_ACCESS_KEY_ID` | Yes | S3 API Access Key ID | `s3-access-key` |
| `S3_SECRET_ACCESS_KEY` | Yes | S3 API Secret Access Key | `s3-secret-key` |
| `SENTRY_DSN` | No | Sentry DSN for exception telemetry | `https://key@o12345.ingest.sentry.io/67890` |

---

## Design Decisions & Trade-offs

1. **Modular Monolith vs Microservices (§1):**
   - Built with strict domain module boundaries (`auth`, `workspaces`, `boards`, `tasks`, `activity`).
   - Modules communicate via public interfaces and shared transactions; no distributed 2-phase commits or network hops between services. Background workers and outbox relay can be scaled independently into separate processes.

2. **Fractional Ordering vs Integer Positions (§5.3):**
   - Moving an item calculates the midpoint between adjacent positions (`(prev + next) / 2`).
   - **Trade-off:** Reordering updates exactly **1 row** ($O(1)$ complexity), avoiding cascading row updates across thousands of items in large columns. Periodic column normalization eliminates precision edge cases.

3. **Cursor vs Offset Pagination (§6.1):**
   - Offset pagination (`OFFSET 50000 LIMIT 20`) causes severe table scan performance degradation ($O(N)$).
   - Keyset cursor pagination uses composite indexes `(createdAt, id)` or `(dueDate, id)`, executing in $O(1)$ constant time regardless of page depth and preventing duplicate/skipped rows during concurrent insertions.

4. **Short-Lived Access + Rotating Refresh Tokens (§5.1):**
   - 15-minute stateless JWT access tokens minimize token revocation delay.
   - Long-lived refresh tokens rotate on every exchange and are grouped into token families. If an already-rotated token is reused, the entire family is immediately revoked, defeating token theft.

5. **Cache-Aside with TTL + Explicit Invalidation (§6.4):**
   - Full board reads are cached in Redis (`board:{id}`) with a 5-minute TTL.
   - Any mutation affecting board columns or tasks immediately evicts the cached key, ensuring strict read-after-write consistency.

6. **Emit-After-Commit vs Transactional Outbox (§14.2):**
   - Direct emit after DB update loses events if the application crashes before the event reaches Redis or the mail server.
   - Outbox rows are written in the same DB transaction as the domain change. The relay polls via `FOR UPDATE SKIP LOCKED`, guaranteeing at-least-once delivery.

---

## Security

- **Broken Access Control (IDOR):** Every tenant resource check resolves through workspace membership. Attempting to access resources in another workspace returns `404 Not Found` (preventing ID enumeration).
- **Injection Protection:** All queries are parameterised through Prisma ORM and sanitized PostgreSQL client queries.
- **Identification & Auth Failures:** Passwords hashed with Argon2id; refresh tokens rotate on each exchange with automatic revocation of entire token family if reuse is detected. Rate-limiting protects auth endpoints from brute force.
- **Security Misconfiguration:** Strict Content Security Policy (CSP) with `helmet`, CORS allow-list restricted to `APP_URL`, body size limit capped at `1mb`, secrets redacted from logs.
- **Vulnerable Dependencies:** Automated `npm audit` and dependabot scanning in CI pipeline.

---

## Deployment

### Hosting Strategy
1. **Compute:** Render / Railway / Fly.io running two services from the same Docker image:
   - Web API Service: `node dist/server.js` (Healthcheck probe: `/health`)
   - Background Worker Service: `node dist/worker.js`
2. **Database:** Neon or Supabase managed PostgreSQL (with PgBouncer connection pooling).
3. **Redis:** Upstash Redis or host Redis add-on (separate connections for cache and BullMQ queues).
4. **Storage:** Cloudflare R2 or AWS S3 with CORS rules allowing the frontend origin.

### CI/CD Flow
The GitHub Actions pipeline (`.github/workflows/ci.yml`) runs on every pull request and push to `main`:
1. **Linting:** ESLint with zero warnings allowed.
2. **Typecheck:** `tsc --noEmit` verifying full TypeScript safety.
3. **Database Migration:** Deploys pending migrations against CI PostgreSQL service container.
4. **Coverage Testing:** Runs test suite enforcing ≥70% coverage.
5. **Build:** Compiles TypeScript to `dist/`.
6. **Deploy:** Triggers host deploy webhook (`RENDER_DEPLOY_HOOK` or `RAILWAY_DEPLOY_TOKEN`).

### How to Roll Back
1. **Application Rollback:** Revert commit on `main` or trigger instant deployment of previous container digest in host dashboard.
2. **Database Rollback:** Migrations adhere to the expand-migrate-contract zero-downtime pattern. Forward-compatible migrations can be rolled back via `npx prisma migrate resolve`.

---

## Roadmap

- [ ] Google OAuth2 Single Sign-On (SSO)
- [ ] Dedicated full-text search engine (Meilisearch / OpenSearch fed by outbox relay)
- [ ] Workspace audit log export (CSV / JSON streaming)
- [ ] Outbound webhooks for third-party integrations (Slack, Discord, Zapier)

---

## License

ISC License.
