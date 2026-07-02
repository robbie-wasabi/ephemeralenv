import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import type { EphemeralService, PortConfig } from 'ephemeralenv'
import { seedSql } from './seedSql.js'

export type PGliteOptions = {
  env?: string
  port: PortConfig
  sqlDir?: string
  /**
   * Maximum concurrent TCP connections the socket server accepts. PGlite is a
   * single-session database, but the socket layer serializes queries across
   * connections, so pooled clients (Prisma, pg-pool) can safely open several.
   * PGLiteSocketServer's own default is 1, which kills any second connection
   * mid-handshake (ECONNRESET) — defaulting higher here so ordinary pools
   * work out of the box.
   */
  maxConnections?: number
}

const HOST = '127.0.0.1'
const DATABASE = 'postgres'
const USER = 'postgres'
const PASSWORD = 'postgres'
const DEFAULT_MAX_CONNECTIONS = 20

export function pglite(options: PGliteOptions): EphemeralService {
  const envName = options.env ?? 'DATABASE_URL'

  return {
    name: 'PGlite',
    port: options.port,
    async start(ctx) {
      const resolvedPort = await ctx.resolvePort('postgres', options.port, {
        envVar: 'DB_PORT',
        defaultBase: 16_000,
        defaultRange: 5000
      })
      const db = await PGlite.create()
      let seeded: Awaited<ReturnType<typeof seedSql>>
      const server = new PGLiteSocketServer({
        db,
        host: HOST,
        port: resolvedPort.port,
        maxConnections: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS
      })

      try {
        seeded = await seedSql({
          db,
          cwd: ctx.cwd,
          sqlDir: options.sqlDir
        })
        await server.start()
      } catch (error) {
        await db.close().catch(() => undefined)
        throw error
      }

      // PGlite's socket server never speaks TLS, so bake sslmode=disable into
      // the URL. Consumers that only see the generated env — beforeApp
      // commands in backend-only mode, external scripts pointed at the
      // printed URL — must not need to decorate it themselves.
      const url = `postgresql://${USER}:${PASSWORD}@${HOST}:${resolvedPort.port}/${DATABASE}?sslmode=disable`

      return {
        name: 'PGlite',
        env: {
          [envName]: url,
          PGSSLMODE: 'disable'
        },
        metadata: {
          url,
          env: envName,
          ssl: 'disabled'
        },
        seeded,
        async stop() {
          await server.stop()
          await db.close()
        }
      }
    }
  }
}
