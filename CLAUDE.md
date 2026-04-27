# Claude Guidance

## Project Snapshot

`ephemeralenv` is a pnpm TypeScript monorepo for disposable, seeded local QA environments without Docker. The public npm packages are unscoped:

- `ephemeralenv`: core runner, config API, and CLI.
- `ephemeralenv-mongodb`: MongoDB memory-server adapter.
- `ephemeralenv-postgres`: PGlite/Postgres adapter.

Source lives in `packages/*/src`, tests live in `packages/*/test`, and runnable examples live in `examples/express-mongodb` and `examples/express-postgres`.

## Common Commands

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
pnpm clean
```

Use `pnpm build` before running examples so the workspace CLI points at current `dist` output. Example run:

```bash
cd examples/express-mongodb
pnpm ephemeralenv
```

## Coding Notes

Use strict ESM TypeScript with NodeNext resolution. Match the existing style: two-space indentation, single quotes, no semicolons, named exports, and `.js` extensions on relative imports. Keep service adapter behavior deterministic, especially port selection, seed ordering, environment precedence, and cleanup.

Default config files are `ephemeralenv.config.ts`, `.mts`, `.js`, and `.mjs`. Default env files are `.env.ephm` first, then `.env.ephemeral`; explicit `envFile` still wins. Use top-level `beforeApp` command tuples for migration and seed steps that must run after services start and before the app starts.

## Testing Notes

Vitest tests are named `*.test.ts`. Tests that bind localhost ports may need normal host permissions. Prefer temporary directories and explicit fixtures for seed-loader tests.

## Release Notes

Publishing is release-driven through `.github/workflows/publish.yml`. The workflow builds, tests, then publishes all packages with provenance using the `NPM_TOKEN` repo secret. Do not rename packages back to `@ephemeralenv/*` unless the npm scope exists and is owned by the publisher.
