# Changelog

## 0.3.0

- Support backend-only mode: `app` is now optional; services + `beforeApp` run, then hold open until interrupted. `run()` accepts an `AbortSignal` for programmatic shutdown.
- `ephemeralenv-postgres`: the PGlite socket server now accepts pooled clients (20 concurrent connections by default, configurable via `pglite({ maxConnections })`) instead of killing the second connection mid-handshake, and the generated `DATABASE_URL` carries `?sslmode=disable` so it is usable verbatim by consumers that only see the generated env (backend-only mode, `beforeApp`, external scripts). The `DATABASE_POOL_MAX=1` client-side workaround is no longer required.

## 0.2.0

- Add top-level `beforeApp` commands for migrations, Prisma seeding, and other setup steps that need generated service env vars before the app starts.

## 0.1.0

- Initial V1 implementation with the core CLI, MongoDB memory adapter, PGlite adapter, examples, and tests.
