# ADR-0002: Prisma 7 Driver Adapters and Config Architecture

## Status
Accepted

## Date
2026-10-25

## Context
Prisma ORM 7.x introduced breaking architectural changes over Prisma 5.x/6.x:
1. Direct connection URLs in `schema.prisma` (`datasource.url = env(...)`) are superseded by programmatic configuration via `prisma.config.ts`.
2. Generator configuration outputs to dedicated local paths (e.g. `src/generated/prisma`) with the `prisma-client` generator.
3. Database connectivity uses the official `@prisma/adapter-pg` driver adapter powered by standard `pg` Pool/Client for improved performance, connection pooling, and edge/serverless compatibility.

## Decision
We adopted Prisma 7's modern driver adapter pattern:
- Defined `prisma.config.ts` loading database connection configuration from environment variables via `defineConfig`.
- Set `schema.prisma` generator to output to `../src/generated/prisma`.
- Implemented `src/config/prisma.ts` using `PrismaPg` adapter over `pg.Pool`.
- Configured ESLint and TypeScript build targets to properly handle the generated client artifacts.

## Consequences
- **Positive:** Full compatibility with Prisma 7, modern TypeScript type definitions, cleaner connection pooling management via standard `pg.Pool`, and modular driver adapters.
- **Trade-off:** Client imports reference the local generated client module (`src/generated/prisma/client.js`) rather than standard `@prisma/client`.
