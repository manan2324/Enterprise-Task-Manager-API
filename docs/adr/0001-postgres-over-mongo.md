# ADR-0001: PostgreSQL over MongoDB

## Status
Accepted

## Date
2024-10-24

## Context
The Enterprise Task Manager API needs a primary database. The domain includes Users, Workspaces, Boards, Tasks, Tags, Comments, and Activity Logs with many-to-many relationships (memberships, task–tag, assignees).

We evaluated PostgreSQL and MongoDB.

## Decision
We chose **PostgreSQL** as the primary database.

## Rationale

### The domain is relational
Users ↔ workspaces ↔ boards ↔ tasks ↔ tags ↔ comments have many-to-many links (memberships, task–tag, assignees). Joins and foreign keys model this naturally. MongoDB would require either embedding (leading to duplication and update anomalies) or manual reference management (losing the document-model advantage).

### Integrity matters
FK constraints, unique constraints (e.g. `one membership per user per workspace`), and `CHECK` constraints enforce rules the application layer can't forget. A single bug in application code can't corrupt referential integrity.

### Transactions are first-class
The requirement to write activity log entries in the **same transaction** as the business change is trivial and reliable with PostgreSQL. MongoDB multi-document transactions exist but are slower, more limited, and harder to reason about.

### Rich querying
Filtering by status/priority/assignee/due date with composite indexes and keyset pagination is a strength of SQL. The query planner optimizes complex filters automatically.

### Trade-off acknowledged
Schema changes require migrations, and highly nested/unstructured data (e.g. activity `metadata`, notification `payload`) is handled with `JSONB`, which provides most of the flexibility of a document store where needed.

## Consequences
- All schema changes go through Prisma migrations
- We gain ACID transactions, FK constraints, and rich SQL querying
- We need connection pooling (PgBouncer) at scale
- JSONB columns handle semi-structured data (metadata, payloads)
