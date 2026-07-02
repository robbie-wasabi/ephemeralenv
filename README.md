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
- `beforeApp` commands for migrations, Prisma seeding, and other setup steps
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
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<port>/postgres?sslmode=disable
PGSSLMODE=disable
```

The URL carries `sslmode=disable` because the PGlite socket never speaks TLS — it is usable verbatim by any client, including ones that only see the printed env (backend-only mode, external scripts). The socket server accepts up to 20 concurrent connections by default (queries are serialized onto the single PGlite session); tune with `pglite({ maxConnections })`.

## Prisma and beforeApp Commands

For Prisma projects, prefer running migrations and seeds through Prisma instead of raw SQL seed files. `beforeApp` commands run after services start and generated env vars such as `DATABASE_URL` are available, but before the app process starts.

```ts
import { defineConfig } from 'ephemeralenv'
import { pglite } from 'ephemeralenv-postgres'

export default defineConfig({
  envFile: '.env.ephm',
  namespace: 'my-prisma-app',
  beforeApp: [
    ['pnpm', 'db:migrate:deploy'],
    ['pnpm', 'db:seed']
  ],
  app: {
    command: 'pnpm',
    args: ['dev', '--port', '$APP_PORT'],
    port: { base: 10_000, range: 5000 }
  },
  services: [
    pglite({
      env: 'DATABASE_URL',
      port: { base: 16_000, range: 5000 }
    })
  ]
})
```

Commands run sequentially, inherit stdio, receive the same runtime env as the app, and stop startup if any command exits nonzero.

## Backend-Only Mode

`app` is optional. Omit it to bring up just the services plus `beforeApp` migrations/seeds, then hold everything open until interrupted — no web server. This is ideal for headless tooling (CLIs, integration/tie-out harnesses, batch jobs) that needs the migrated and seeded database but not the app.

```ts
import { defineConfig } from 'ephemeralenv'
import { pglite } from 'ephemeralenv-postgres'

export default defineConfig({
  envFile: '.env.ephm',
  namespace: 'my-app-db',
  beforeApp: [
    ['pnpm', 'db:migrate:deploy'],
    ['pnpm', 'db:seed']
  ],
  services: [
    pglite({
      env: 'DATABASE_URL',
      port: { base: 16_000, range: 5000 }
    })
  ]
})
```

`ephemeralenv` starts the services, runs `beforeApp`, prints the generated connection env (e.g. `DATABASE_URL`), and holds the services open until it receives `SIGINT`/`SIGTERM`. Keep your full config and a separate db-only config, or omit `app` conditionally from one config.

> Connecting your own process (rather than the app) to the PGlite socket? Use the printed `DATABASE_URL` verbatim — it already carries `sslmode=disable`, and the socket server accepts pooled clients (20 concurrent connections by default; queries serialize onto the single PGlite session). No `DATABASE_POOL_MAX=1` workaround is needed.

When embedding `run()` programmatically, pass an `AbortSignal` to trigger the same graceful shutdown:

```ts
import { run } from 'ephemeralenv'

const controller = new AbortController()
const exit = run({ signal: controller.signal })
// ... later, when your harness finishes:
controller.abort()
await exit
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

### Capping Concurrency

Each environment runs a full app process plus a database, so a handful of concurrent environments can exhaust memory. Set `EPHEMERAL_ENV_MAX_PROCESSES` to cap how many run at once on a machine — it is a machine property, so a shell profile is the natural home:

```bash
# ~/.zshrc or ~/.bashrc
export EPHEMERAL_ENV_MAX_PROCESSES=3
```

When the limit is reached, new runs fail fast and list the active environments. Slots are tracked as PID files in `~/.ephemeralenv/slots` (override the location with `EPHEMERAL_ENV_SLOT_DIR`); slots held by crashed processes are reclaimed automatically. Override per shell when needed:

```bash
EPHEMERAL_ENV_MAX_PROCESSES=5 pnpm exec ephemeralenv
```

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

V1 intentionally avoids multi-service orchestration, recursive seed directories, fixture transforms, Docker, and long-lived persistence.

## Troubleshooting

**My app expects SSL Postgres.**
PGlite socket connections do not support SSL. The generated `DATABASE_URL` already appends `sslmode=disable`; if you build your own connection config, use `ssl: false` or `PGSSLMODE=disable`.

**My app opens many Postgres connections.**
PGlite is a single-user database exposed through a socket server. The socket layer accepts up to 20 concurrent connections by default (`pglite({ maxConnections })` to change) and serializes their queries onto the single PGlite session — fine for pooled dev clients, but concurrency is not the same as native Postgres.

**My seed file was not loaded.**
Mongo only reads direct child `*.json` files from `seedDir`. Postgres only reads direct child `*.sql` files from `sqlDir`. Directories are not recursive in V1.

**My port changed.**
The deterministic preferred port was occupied, so the runner selected a free fallback. Set `APP_PORT` or `DB_PORT` to fail instead of falling back.

**I need Prisma migrations.**
Use `beforeApp` to run scripts such as `pnpm db:migrate:deploy` and `pnpm db:seed` after the database starts and before the app starts.

**Multiple Next.js environments slow my machine down.**
Each webpack-based `next dev` process can use 1-3 GB of RAM. If concurrent environments exhaust memory, use Turbopack in your app command for a much smaller footprint:

```ts
app: {
  command: 'pnpm',
  args: ['next', 'dev', '--turbopack', '--port', '$APP_PORT']
}
```
