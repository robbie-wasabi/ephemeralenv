# Ephemeral Dev Plan

## Working Name

`ephemeralenv`

## One Sentence

Spin up disposable, seeded local QA environments without Docker so multiple feature branches can run side by side on different deterministic ports.

## Problem

Local development often depends on a shared database or a slow Docker stack. That makes feature QA fragile:

- One feature branch can pollute another branch's data.
- Developers wait for Docker or local services before testing.
- Running multiple worktrees at the same time causes port and database collisions.
- QA setup instructions drift across projects.
- Seed data is often implicit, stale, or tied to one developer's machine.

The goal is a one-command local environment that behaves like this:

```bash
pnpm ephemeralenv
```

It should start an app process, start a disposable database, seed it, inject the runtime connection string, print useful URLs, and clean everything up on exit.

## Product Promise

`ephemeralenv` creates isolated local QA environments:

- Fast startup.
- No Docker required.
- Fresh seeded database every run.
- Deterministic ports per repo, worktree, or explicit environment id.
- Clear terminal output with app URL and database URL.
- Clean teardown on Ctrl-C.
- Simple enough to adopt in existing projects.

## Initial Users

- Developers running multiple feature worktrees.
- Agents or automation tools that need isolated local app state.
- Small teams that want reproducible QA without maintaining Docker Compose.
- Framework users with common Node app commands such as Next, Vite, Remix, Express, Nest, Hono, or custom TypeScript servers.

## Non-Goals for V1

- No production database management.
- No Docker orchestration.
- No multi-service graphs beyond one app plus one database.
- No ORM-specific migration abstraction.
- No custom parser or transform hooks.
- No fixture generation.
- No remote deployment.
- No long-lived persistence by default.
- No attempt to perfectly emulate every production database behavior.

## Supported Databases in V1

### MongoDB

Use `mongodb-memory-server`.

Behavior:

- Start an in-memory MongoDB instance.
- Pick a deterministic available port.
- Load Mongo EJSON fixture files from a seed directory.
- Map each `*.json` file to a collection with the same base name.
- Inject `MONGODB_URI`.
- Stop MongoDB on app exit.

### PostgreSQL

Use PGlite plus the PGlite socket server.

Behavior:

- Start an in-memory PGlite instance.
- Expose it over the Postgres wire protocol with `@electric-sql/pglite-socket`.
- Pick a deterministic available port.
- Run `*.sql` files from a seed directory in lexical order.
- Inject `DATABASE_URL`.
- Set `PGSSLMODE=disable`.
- Stop PGlite and the socket server on app exit.

Important caveat: PGlite is not native Postgres. It is good for fast local QA, but the docs must clearly call out differences around concurrency, extensions, SSL, and exact production parity.

## V1 Configuration

Keep config boring. Users should not need to learn a framework or custom plugin syntax.

```ts
import { defineConfig } from '@ephemeralenv/core'
import { mongoMemory } from '@ephemeralenv/mongodb'

export default defineConfig({
  envFile: '.env.ephm',
  namespace: 'my-app',

  app: {
    command: 'pnpm',
    args: ['dev', '--port', '$APP_PORT'],
    port: { base: 10000, range: 5000 }
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

Postgres variant:

```ts
import { defineConfig } from '@ephemeralenv/core'
import { pglite } from '@ephemeralenv/postgres'

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

## Seed Conventions

### MongoDB

Every `*.json` file in `seedDir` is a collection.

```txt
data/seeds/mongo/users.json       -> db.collection('users')
data/seeds/mongo/accounts.json    -> db.collection('accounts')
data/seeds/mongo/properties.json  -> db.collection('properties')
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

V1 does not support seed transforms. Projects that need transformed fixtures should materialize those fixtures before using `ephemeralenv`.

### PostgreSQL

Every `*.sql` file in `sqlDir` is executed in lexical order.

```txt
data/seeds/postgres/
  001_schema.sql
  002_reference_data.sql
  003_seed_users.sql
```

The package should run each file as SQL against the fresh PGlite database before starting the app.

## CLI UX

Primary command:

```bash
pnpm ephemeralenv
```

With config path:

```bash
pnpm ephemeralenv --config ephemeralenv.config.ts
```

With explicit environment id:

```bash
EPHEMERAL_ENV_ID=feature-action-items pnpm ephemeralenv
```

With explicit ports:

```bash
APP_PORT=3100 DB_PORT=3101 pnpm ephemeralenv
```

Expected output:

```txt
ephemeralenv

Environment:
  namespace: my-app
  id: my-app:/Users/robert/github/my-app-feature-a

Services:
  MongoDB memory server
    uri: mongodb://127.0.0.1:15384/
    env: MONGODB_URI

Seeded:
  users: 12 docs
  accounts: 4 docs
  properties: 106 docs

App:
  command: pnpm dev --port 10842
  url: http://localhost:10842

Use this database from another script:
  MONGODB_URI="mongodb://127.0.0.1:15384/" pnpm your-script
```

For Postgres:

```txt
Services:
  PGlite
    url: postgresql://postgres:postgres@127.0.0.1:16042/postgres
    env: DATABASE_URL
    ssl: disabled
```

## Port Strategy

Ports must be stable but collision-resistant.

Inputs:

- `EPHEMERAL_ENV_ID` if provided.
- Otherwise `process.cwd()`.
- Include `namespace` so different projects do not converge if paths are similar.

Algorithm:

1. Build a stable seed string:

```txt
${namespace}:${EPHEMERAL_ENV_ID || process.cwd()}:${portName}
```

2. Hash it.
3. Map into the configured range:

```txt
base + (hash % range)
```

4. Check if the preferred port is available on `127.0.0.1` and the default host.
5. If unavailable and the user did not explicitly set the port, ask the OS for a free port.
6. If the user explicitly set the port and it is unavailable, fail loudly.

Default ranges:

- app: `10000-14999`
- MongoDB: `15000-19999`
- Postgres/PGlite: `16000-20999`

Environment variables:

- `APP_PORT` overrides app port.
- `DB_PORT` overrides the database service port.
- Adapter-specific overrides can be added later if needed.

## Environment Strategy

Order of precedence:

1. Existing process environment.
2. Values from `envFile` or default `.env.ephm` / `.env.ephemeral`.
3. Values generated by services.
4. Values generated by the app launcher.

Generated values should intentionally override placeholder values from the env file.

Examples:

- `MONGODB_URI`
- `DATABASE_URL`
- `APP_PORT`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_SITE_URL`

For v1, only `APP_PORT` is generated by core. Framework-specific URL env vars should be optional config:

```ts
app: {
  command: 'pnpm',
  args: ['next', 'dev', '--port', '$APP_PORT'],
  port: { base: 10000, range: 5000 },
  env: {
    NEXTAUTH_URL: 'http://localhost:$APP_PORT',
    NEXT_PUBLIC_SITE_URL: 'http://localhost:$APP_PORT'
  }
}
```

String interpolation should support `$APP_PORT` and generated service env names.

## Process Lifecycle

Startup order:

1. Load config.
2. Load env file.
3. Resolve deterministic ports.
4. Start database service.
5. Seed database service.
6. Build app env.
7. Spawn app command.
8. Forward app stdio.
9. Wait for app exit or termination signal.
10. Stop app if still running.
11. Stop database service.
12. Exit with app exit code when possible.

Signals:

- `SIGINT`
- `SIGTERM`
- `SIGHUP` where supported

The cleanup path must be idempotent. Multiple signals should not attempt duplicate teardown.

## Package Layout

Use a small monorepo so adapters can have independent dependencies.

```txt
ephemeralenv/
  README.md
  PLAN.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    core/
      package.json
      src/
        cli.ts
        config.ts
        defineConfig.ts
        env.ts
        interpolate.ts
        lifecycle.ts
        logger.ts
        ports.ts
        run.ts
        service.ts
        spawnApp.ts
    mongodb/
      package.json
      src/
        index.ts
        mongoMemory.ts
        seedMongo.ts
    postgres/
      package.json
      src/
        index.ts
        pglite.ts
        seedSql.ts
  examples/
    next-mongodb/
      package.json
      ephemeralenv.config.ts
      .env.ephm.example
      data/seeds/mongo/
    vite-postgres/
      package.json
      ephemeralenv.config.ts
      .env.ephm.example
      data/seeds/postgres/
```

## Public Packages

V1 packages:

- `@ephemeralenv/core`
- `@ephemeralenv/mongodb`
- `@ephemeralenv/postgres`

The CLI can live in core:

```bash
pnpm add -D @ephemeralenv/core @ephemeralenv/mongodb
pnpm ephemeralenv
```

Package bin:

```json
{
  "bin": {
    "ephemeralenv": "./dist/cli.js"
  }
}
```

## Core API

Minimal types:

```ts
export type PortConfig = {
  base: number
  range?: number
}

export type AppConfig = {
  command: string
  args?: string[]
  port: PortConfig
  env?: Record<string, string>
}

export type EphemeralConfig = {
  envFile?: string
  namespace?: string
  app: AppConfig
  services: EphemeralService[]
}

export type ServiceStartResult = {
  name: string
  env: Record<string, string>
  metadata?: Record<string, string | number | boolean>
  stop: () => Promise<void>
}

export type EphemeralService = {
  name: string
  port?: PortConfig
  start: (ctx: ServiceContext) => Promise<ServiceStartResult>
}

export function defineConfig(config: EphemeralConfig): EphemeralConfig {
  return config
}
```

The service interface should be internal-friendly but not over-designed. V1 only needs one service, but supporting `services: []` keeps the config shape future-proof.

## Mongo Adapter API

```ts
export type MongoMemoryOptions = {
  env?: string
  version?: string
  port: PortConfig
  seedDir?: string
}

export function mongoMemory(options: MongoMemoryOptions): EphemeralService
```

Defaults:

- `env`: `MONGODB_URI`
- `version`: whatever `mongodb-memory-server` chooses, unless specified

Seed behavior:

1. Resolve `seedDir` relative to project root.
2. Read all direct child `*.json` files.
3. Parse each as Mongo EJSON.
4. Require array at top level.
5. Insert non-empty arrays with `insertMany`.
6. Print counts.

Do not recurse in v1.

## Postgres Adapter API

```ts
export type PGliteOptions = {
  env?: string
  port: PortConfig
  sqlDir?: string
}

export function pglite(options: PGliteOptions): EphemeralService
```

Defaults:

- `env`: `DATABASE_URL`
- host: `127.0.0.1`
- database: `postgres`
- user: `postgres`
- password: `postgres`

Seed behavior:

1. Resolve `sqlDir` relative to project root.
2. Read all direct child `*.sql` files.
3. Sort lexically.
4. Execute each file against PGlite before app startup.
5. Print filenames as they run.

Generated env:

```txt
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<port>/postgres
PGSSLMODE=disable
```

## Config Loading

Support TypeScript config from the start.

Config file names:

- `ephemeralenv.config.ts`
- `ephemeralenv.config.mts`
- `ephemeralenv.config.js`
- `ephemeralenv.config.mjs`

Implementation options:

- Use `tsx` internally to load TS config, or
- Use dynamic import with a lightweight TS loader.

Simplest v1 path: depend on `tsx` and use it for config loading.

## Logging

Logging should be readable, not noisy.

Required log groups:

- environment id
- selected ports
- started services
- seed counts
- app command
- app URL
- reusable database command
- cleanup messages

Errors should include:

- missing config file
- unavailable explicit port
- malformed seed JSON
- SQL file failure with file name
- database start failure
- app command spawn failure

## Testing Plan

### Unit Tests

Core:

- deterministic hash produces stable ports
- explicit ports override generated ports
- occupied preferred port falls back when not explicit
- occupied explicit port fails
- env file loads from `.env.ephm` and `.env.ephemeral`
- generated env overrides env-file placeholders
- interpolation replaces `$APP_PORT`
- cleanup is idempotent

Mongo adapter:

- maps JSON filenames to collections
- parses Mongo EJSON ObjectId and Date
- rejects non-array seed file
- skips empty arrays
- inserts expected document counts

Postgres adapter:

- runs SQL files in lexical order
- exposes a connection string
- can be queried through a normal Postgres client
- fails with the SQL filename when a seed file has invalid SQL

### Integration Tests

Use small fixture apps in `examples/`.

Mongo integration:

- start example with `ephemeralenv`
- fetch app endpoint that reads from Mongo
- assert seeded data is returned
- terminate process
- assert port is closed

Postgres integration:

- start example with `ephemeralenv`
- fetch app endpoint that reads from Postgres
- assert seeded data is returned
- terminate process
- assert port is closed

Parallel integration:

- start two copies with different `EPHEMERAL_ENV_ID`
- assert app ports differ
- assert database ports differ
- write data in one environment
- assert the other environment does not see it

## Documentation Plan

README should lead with the use case:

```md
# ephemeralenv

Disposable, seeded local QA environments without Docker.
```

README sections:

1. Why this exists.
2. Quick start with MongoDB.
3. Quick start with Postgres/PGlite.
4. Seed file conventions.
5. Running multiple environments.
6. Port strategy.
7. Environment variable behavior.
8. Limitations.
9. Troubleshooting.

Important examples:

```bash
EPHEMERAL_ENV_ID=feature-a pnpm ephemeralenv
EPHEMERAL_ENV_ID=feature-b pnpm ephemeralenv
```

Troubleshooting:

- "My app expects SSL Postgres."
- "My app opens too many Postgres connections."
- "My seed file was not loaded."
- "My port changed."
- "I need Prisma migrations."

## Implementation Phases

### Phase 0: Repository Scaffold

Deliverables:

- pnpm workspace
- TypeScript config
- package structure
- lint/test setup
- placeholder README
- MIT license

Acceptance criteria:

- `pnpm install` works
- `pnpm build` works
- packages compile

### Phase 1: Core Runner

Deliverables:

- config loader
- dotenv loader
- deterministic port utility
- env interpolation
- app process spawning
- signal cleanup
- basic CLI

Acceptance criteria:

- can run a no-database fixture app on deterministic port
- Ctrl-C stops child process
- explicit app port works
- occupied explicit app port fails

### Phase 2: MongoDB Adapter

Deliverables:

- `mongoMemory()` service
- MongoDB startup and teardown
- EJSON seed directory loading
- seed counts in logger
- example Next or Express Mongo app

Acceptance criteria:

- `examples/next-mongodb` starts with seeded data
- endpoint can read seeded docs
- app receives `MONGODB_URI`
- no Docker required

### Phase 3: PGlite Adapter

Deliverables:

- `pglite()` service
- PGlite socket server startup and teardown
- SQL directory seeding
- generated `DATABASE_URL`
- `PGSSLMODE=disable`
- example Vite/Express or Next/Postgres app

Acceptance criteria:

- example starts with seeded Postgres data
- normal Postgres client library can query it
- app receives `DATABASE_URL`
- no Docker or native Postgres required

### Phase 4: Parallel QA Hardening

Deliverables:

- `EPHEMERAL_ENV_ID` support
- stronger output for active environment identity
- integration test for two simultaneous environments
- docs for worktree usage

Acceptance criteria:

- two environments run concurrently without port collisions
- data writes are isolated
- terminal output clearly identifies each environment

### Phase 5: Public Release

Deliverables:

- final README
- examples documented
- package publishing workflow
- changelog
- npm provenance if desired
- GitHub Actions CI

Acceptance criteria:

- package can be installed into a fresh project
- quick starts work from README
- CI runs build and tests

## V2 Ideas

These should wait until v1 is stable:

- Multiple services per app.
- Redis adapter.
- MinIO adapter.
- Native local Postgres binary adapter.
- Optional persistent mode.
- ORM helpers for Prisma, Drizzle, TypeORM, and Kysely.
- Custom seed hooks.
- Recursive seed directories.
- Health-check URL before printing "ready".
- Browser auto-open.
- JSON summary output for agents.
- `ephemeralenv doctor`.
- `ephemeralenv ports`.

## Key Design Decisions

### Use "Ephemeral Environment" Language

The abstraction is not "in-memory database." The abstraction is a disposable, isolated local QA environment. MongoDB and PGlite are implementation details.

### Keep V1 Seed Loading Simple

Mongo uses one collection per JSON file. Postgres uses SQL files in lexical order. Domain-specific fixture shaping is outside the package.

### Prefer Deterministic Ports

Stable ports make bookmarks, OAuth callbacks, screenshots, and repeated QA easier. Fallback ports keep the tool usable when collisions happen.

### Avoid Docker

Docker can be added as a future adapter, but the point of this package is fast startup and low local setup burden.

### Avoid ORM Coupling

The package should inject connection strings and run plain fixtures. ORMs can consume those connection strings normally.

## Risks

### PGlite Compatibility

Risk: Some apps depend on native Postgres behavior PGlite does not support.

Mitigation:

- Document limitations clearly.
- Keep SQL fixture support basic.
- Add native Postgres or Docker adapters later for parity-sensitive projects.

### Mongo Binary Download

Risk: `mongodb-memory-server` may download MongoDB binaries on first use.

Mitigation:

- Document first-run behavior.
- Allow version pinning.
- Surface download failures clearly.

### Seed Data Drift

Risk: Projects still need good fixtures.

Mitigation:

- Make seed loading explicit and noisy.
- Fail on malformed seed files.
- Provide small fixture examples.

### Port Collisions

Risk: Deterministic ports can still collide.

Mitigation:

- Check availability.
- Fallback if not explicit.
- Print when fallback happens.
- Support `EPHEMERAL_ENV_ID`.

## Success Criteria

V1 is successful when a developer can add this to an existing app in under 15 minutes:

```bash
pnpm add -D @ephemeralenv/core @ephemeralenv/mongodb
```

Add:

```ts
// ephemeralenv.config.ts
import { defineConfig } from '@ephemeralenv/core'
import { mongoMemory } from '@ephemeralenv/mongodb'

export default defineConfig({
  envFile: '.env.ephm',
  app: {
    command: 'pnpm',
    args: ['dev', '--port', '$APP_PORT'],
    port: { base: 10000, range: 5000 }
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

Then run:

```bash
pnpm ephemeralenv
```

And get:

- a seeded app at a local URL
- an isolated disposable database
- no Docker
- no shared local database state
- clean shutdown
- a second feature branch running at the same time with a different environment id
