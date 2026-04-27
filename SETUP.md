# Agent Setup Guide

Use this guide when setting up `ephemeralenv` in another project. The goal is to run the app with disposable local services, deterministic ports, seed data, and generated connection strings.

## 1. Inspect the Target Project

Before editing files, identify:

- package manager: `pnpm`, `npm`, `yarn`, or `bun`
- app start command, for example `pnpm dev`, `npm run dev`, or `next dev`
- whether the app accepts a port flag such as `--port`, `-p`, or `PORT`
- database type: MongoDB, Postgres-compatible, both, or neither
- expected env vars, usually `MONGODB_URI`, `DATABASE_URL`, `PGSSLMODE`, app URL vars, or auth callback URLs
- existing seed or fixture directories

Prefer the project's existing scripts and env conventions. Do not rename the app's production env vars; generate compatible local values instead.

## 2. Install Packages

Install the core CLI and only the service adapters the project needs.

pnpm:

```bash
pnpm add -D ephemeralenv
pnpm add -D ephemeralenv-mongodb    # MongoDB projects
pnpm add -D ephemeralenv-postgres   # Postgres/PGlite projects
```

npm:

```bash
npm install -D ephemeralenv
npm install -D ephemeralenv-mongodb    # MongoDB projects
npm install -D ephemeralenv-postgres   # Postgres/PGlite projects
```

The packages are intentionally unscoped. Do not use `@ephemeralenv/*` package names.

## 3. Add a Config File

Create `ephemeralenv.config.ts` in the project root. Use `.env.ephm` for local placeholders; `.env.ephemeral` is also supported.

MongoDB example:

```ts
import { defineConfig } from 'ephemeralenv'
import { mongoMemory } from 'ephemeralenv-mongodb'

export default defineConfig({
  envFile: '.env.ephm',
  namespace: 'my-app',
  app: {
    command: 'pnpm',
    args: ['dev', '--port', '$APP_PORT'],
    port: { base: 10_000, range: 5000 },
    env: {
      NEXT_PUBLIC_SITE_URL: 'http://localhost:$APP_PORT'
    }
  },
  services: [
    mongoMemory({
      env: 'MONGODB_URI',
      version: '7.0.0',
      port: { base: 15_000, range: 5000 },
      seedDir: 'data/seeds/mongo'
    })
  ]
})
```

Postgres/PGlite example:

```ts
import { defineConfig } from 'ephemeralenv'
import { pglite } from 'ephemeralenv-postgres'

export default defineConfig({
  envFile: '.env.ephm',
  namespace: 'my-app',
  app: {
    command: 'pnpm',
    args: ['dev', '--port', '$APP_PORT'],
    port: { base: 10_000, range: 5000 }
  },
  services: [
    pglite({
      env: 'DATABASE_URL',
      port: { base: 16_000, range: 5000 },
      sqlDir: 'data/seeds/postgres'
    })
  ]
})
```

If the project uses `npm`, `yarn`, or `bun`, change `app.command` and `app.args` to match the existing dev script.

## 4. Add Env and Seed Files

Add `.env.ephm.example` with harmless placeholders so contributors know what is expected:

```bash
DATABASE_URL=postgresql://placeholder.invalid/postgres
MONGODB_URI=mongodb://placeholder.invalid/
NEXT_PUBLIC_SITE_URL=http://localhost:0
```

Do not commit real `.env.ephm` or `.env.ephemeral` files. For seeds:

- MongoDB reads direct child `*.json` files from `seedDir`; each file must be a JSON array and maps to a collection name.
- Postgres reads direct child `*.sql` files from `sqlDir` in lexical order, for example `001_schema.sql`, `002_seed_users.sql`.

## 5. Add a Package Script

Add a short script to the target project's `package.json`:

```json
{
  "scripts": {
    "ephemeralenv": "ephemeralenv"
  }
}
```

Then run:

```bash
pnpm ephemeralenv
```

Without a script, use:

```bash
pnpm exec ephemeralenv
```

## 6. Verify the Setup

Run the wrapper and confirm:

- the startup summary prints the selected app and database ports
- generated env vars match the app's expected names
- seed files are reported as loaded
- the app URL responds
- `Ctrl+C` stops the app and services cleanly

Useful overrides:

```bash
EPHEMERAL_ENV_ID=feature-a pnpm exec ephemeralenv
APP_PORT=3100 DB_PORT=3101 pnpm exec ephemeralenv
```

If an explicit port is occupied, startup should fail. If a generated preferred port is occupied, `ephemeralenv` falls back to a free port and prints the fallback.

## 7. Common Adjustments

- Next.js: pass `--port $APP_PORT` and set callback/site URL env vars in `app.env`.
- Vite: pass `--host 127.0.0.1 --port $APP_PORT` if the project expects explicit host binding.
- Prisma or other migration tools: run migrations in the app command or a project-local wrapper script before starting the dev server.
- SSL Postgres clients: disable SSL locally or honor `PGSSLMODE=disable` from the PGlite adapter.
