# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm TypeScript monorepo for `ephemeralenv`, a disposable local QA environment runner. Package source lives under `packages/*/src`, with public entry points in each package's `src/index.ts`.

- `packages/core`: published as `ephemeralenv`; CLI, config loading, lifecycle, environment merging, port resolution, and app spawning.
- `packages/postgres`: published as `ephemeralenv-postgres`; PGlite/Postgres adapter and SQL seeding helpers.
- `packages/mongodb`: published as `ephemeralenv-mongodb`; MongoDB memory-server adapter and JSON seeding helpers.
- `packages/*/test`: Vitest unit tests, named `*.test.ts`.
- `examples/express-mongodb` and `examples/express-postgres`: runnable integration examples with seed data under `data/seeds`.
- `dist` directories are generated build output.

## Build, Test, and Development Commands

Use pnpm 9.11.0 and Node 24, matching CI.

- `pnpm install --frozen-lockfile`: install workspace dependencies without changing the lockfile.
- `pnpm build`: compile all packages in `packages/**` with `tsc`.
- `pnpm test`: run Vitest across `packages/**/*.test.ts`.
- `pnpm typecheck`: run `tsc --noEmit` for every package.
- `pnpm clean`: remove generated package `dist` directories.
- `cd examples/express-mongodb && pnpm ephemeralenv`: run an example app through the local CLI after building packages.

## Coding Style & Naming Conventions

Write ESM TypeScript targeting ES2022 and NodeNext module resolution. Keep strict types enabled and prefer explicit exported types for package APIs. Follow the existing style: two-space indentation, single quotes, no semicolons, named exports, and `.js` extensions in relative TypeScript imports that compile to ESM. Use descriptive camelCase for functions and variables, PascalCase for types/classes, and uppercase names for constants such as `DEFAULT_CONFIG_FILES`.

## Testing Guidelines

Vitest is the test runner. Place tests beside each package in `packages/<name>/test` and name files after the behavior under test, for example `ports.test.ts` or `seedSql.test.ts`. Prefer deterministic tests using temporary directories, local ports from helpers, and explicit assertions for failure messages. Run `pnpm test` before submitting; run `pnpm typecheck` when changing public types.

## Commit & Pull Request Guidelines

Use concise imperative commit subjects such as `Add postgres seed ordering test` or `Use unscoped npm package names`. Pull requests should include a short summary, the affected packages, test results (`pnpm build`, `pnpm test`, and any relevant example run), and linked issues when applicable. Include screenshots or logs only when changing CLI output or example behavior.

## Release Notes

The npm packages are intentionally unscoped: `ephemeralenv`, `ephemeralenv-mongodb`, and `ephemeralenv-postgres`. Publishing is handled by `.github/workflows/publish.yml` when a GitHub release is created; the workflow expects the `NPM_TOKEN` repository secret. Keep package versions aligned across all three packages for each release.

## Security & Configuration Tips

Do not commit local `.env.ephm`, `.env.ephemeral`, or machine-specific port settings. Keep seed fixtures small and non-sensitive. When adding service adapters, make generated connection strings explicit in tests and ensure cleanup paths are idempotent.
