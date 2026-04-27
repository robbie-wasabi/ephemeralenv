import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import type { EphemeralService, PortConfig } from '@ephemeralenv/core'
import { seedSql } from './seedSql.js'

export type PGliteOptions = {
  env?: string
  port: PortConfig
  sqlDir?: string
}

const HOST = '127.0.0.1'
const DATABASE = 'postgres'
const USER = 'postgres'
const PASSWORD = 'postgres'

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
      const seeded = await seedSql({
        db,
        cwd: ctx.cwd,
        sqlDir: options.sqlDir
      })
      const server = new PGLiteSocketServer({
        db,
        host: HOST,
        port: resolvedPort.port
      })

      await server.start()

      const url = `postgresql://${USER}:${PASSWORD}@${HOST}:${resolvedPort.port}/${DATABASE}`

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
