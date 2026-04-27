# ephemeralenv

Disposable, seeded local QA environments without Docker.

`ephemeralenv` starts your app with an isolated throwaway database, deterministic ports, seed data, runtime connection strings, and clean teardown on exit.

## Why This Exists

Local QA often depends on a shared database or a slow Docker stack. That makes feature work fragile: branches pollute each other's data, multiple worktrees collide on ports, and setup instructions drift.

`ephemeralenv` gives each run a fresh local environment:

- deterministic app and database ports per repo, worktree, or `EPHEMERAL_ENV_ID`
- MongoDB via `mongodb-memory-server`
- PostgreSQL-compatible development databases via PGlite and `@electric-sql/pglite-socket`
- direct seed loading from plain JSON or SQL files
- generated `MONGODB_URI` or `DATABASE_URL`
- idempotent cleanup on app exit, `SIGINT`, `SIGTERM`, or `SIGHUP`

## Install

Install the core package for the CLI and config helpers:

```bash
pnpm add -D ephemeralenv
```

Add one or more service adapters:

```bash
pnpm add -D ephemeralenv-mongodb
pnpm add -D ephemeralenv-postgres
```

Published packages:

- `ephemeralenv`: core API, config loader, port resolver, runner, and `ephemeralenv` CLI.
- `ephemeralenv-mongodb`: MongoDB memory-server adapter and JSON seed loading.
- `ephemeralenv-postgres`: PGlite/Postgres adapter and SQL seed loading.

## CLI

The core package exposes the `ephemeralenv` binary:

```bash
pnpm exec ephemeralenv
pnpm exec ephemeralenv --config ephemeralenv.config.ts
pnpm exec ephemeralenv --help
```

By default, the CLI looks for `ephemeralenv.config.ts`, `.mts`, `.js`, or `.mjs` in the current working directory.

## Quick Start: MongoDB

Create `ephemeralenv.config.ts`:

```ts
import { defineConfig } from 'ephemeralenv'
import { mongoMemory } from 'ephemeralenv-mongodb'

export default defineConfig({
  envFile: '.env.ephm',
  namespace: 'my-app',
  app: {
    command: 'pnpm',
    args: ['dev', '--port', '$APP_PORT'],
    port: { base: 10000, range: 5000 },
    env: {
      NEXTAUTH_URL: 'http://localhost:$APP_PORT',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:$APP_PORT'
    }
  },
  services: [
    mongoMemory({
      env: 'MONGODB_URI',
      version: '7.0.0',
      port: { base: 15000, range: 5000 },
      seedDir: 'data/seeds/mongo'
    })
  ]
})
```

Seed files map directly to collections:

```txt
data/seeds/mongo/users.json      -> users
data/seeds/mongo/accounts.json   -> accounts
```

Each file must contain a JSON array. Mongo EJSON is supported:

```json
[
  {
    "_id": { "$oid": "6877e615628074e008b7628f" },
    "email": "admin@example.com",
    "createdAt": { "$date": "2026-01-01T00:00:00.000Z" }
  }
]
```

Run it:

```bash
pnpm exec ephemeralenv
```

## Quick Start: Postgres/PGlite

Create `ephemeralenv.config.ts`:

```ts
import { defineConfig } from 'ephemeralenv'
import { pglite } from 'ephemeralenv-postgres'

export default defineConfig({
  envFile: '.env.ephm',
  namespace: 'my-app',
  app: {
    command: 'pnpm',
    args: ['dev', '--port', '$APP_PORT'],
    port: { base: 10000, range: 5000 }
  },
  services: [
    pglite({
      env: 'DATABASE_URL',
      port: { base: 16000, range: 5000 },
      sqlDir: 'data/seeds/postgres'
    })
  ]
})
```

SQL files run in lexical order:

```txt
data/seeds/postgres/
  001_schema.sql
  002_reference_data.sql
  003_seed_users.sql
```

The app receives:

```txt
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<port>/postgres
PGSSLMODE=disable
```

## Running Multiple Environments

Ports are derived from:

```txt
${namespace}:${EPHEMERAL_ENV_ID || process.cwd()}:${portName}
```

Use an explicit id when running multiple branches or worktrees:

```bash
EPHEMERAL_ENV_ID=feature-a pnpm exec ephemeralenv
EPHEMERAL_ENV_ID=feature-b pnpm exec ephemeralenv
```

You can also force ports:

```bash
APP_PORT=3100 DB_PORT=3101 pnpm exec ephemeralenv
```

If an explicit port is occupied, startup fails. If a deterministic generated port is occupied, `ephemeralenv` falls back to an OS-selected free port and prints the fallback.

## Environment Variables

Runtime env is built from:

1. `.env.ephm` or `.env.ephemeral` values
2. generated service and app values
3. existing process env

By default, `ephemeralenv` looks for `.env.ephm` first and then `.env.ephemeral`. You can also set `envFile` in `ephemeralenv.config.ts` to load a specific file.

Generated values intentionally override placeholders from the env file. Existing shell variables remain highest precedence, which is useful for deliberately overriding app-specific settings.

String interpolation supports `$APP_PORT`, `${APP_PORT}`, and generated service env names in app args and `app.env`.

## Examples

This repo includes:

- `examples/express-mongodb`
- `examples/express-postgres`

After installing dependencies and building packages:

```bash
pnpm install
pnpm build
cd examples/express-mongodb
pnpm ephemeralenv
```

Then visit the printed app URL or fetch `/users`.

## Limitations

PGlite is not native Postgres. It is excellent for fast local QA, but it does not guarantee exact production parity. Be careful with concurrency behavior, extensions, SSL expectations, and workloads that depend on native Postgres process semantics.

`mongodb-memory-server` may download a MongoDB binary on first use. Pin `version` in the adapter config when you want reproducible binary selection.

V1 intentionally avoids ORM-specific migration hooks, multi-service orchestration, recursive seed directories, fixture transforms, Docker, and long-lived persistence.

## Troubleshooting

**My app expects SSL Postgres.**
PGlite socket connections do not support SSL. Configure your local client with `ssl: false` or `PGSSLMODE=disable`.

**My app opens many Postgres connections.**
PGlite is a single-user database exposed through a socket server. It can support multiple clients through the socket layer, but concurrency is not the same as native Postgres.

**My seed file was not loaded.**
Mongo only reads direct child `*.json` files from `seedDir`. Postgres only reads direct child `*.sql` files from `sqlDir`. Directories are not recursive in V1.

**My port changed.**
The deterministic preferred port was occupied, so the runner selected a free fallback. Set `APP_PORT` or `DB_PORT` to fail instead of falling back.

**I need Prisma migrations.**
Run migrations as part of your app command or add a project-local script before `ephemeralenv`. V1 only injects connection strings and runs plain seed files.
