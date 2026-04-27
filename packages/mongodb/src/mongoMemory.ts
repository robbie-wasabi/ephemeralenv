import { MongoMemoryServer } from 'mongodb-memory-server'
import type { EphemeralService, PortConfig } from '@ephemeralenv/core'
import { seedMongo } from './seedMongo.js'

export type MongoMemoryOptions = {
  env?: string
  version?: string
  port: PortConfig
  seedDir?: string
}

export function mongoMemory(options: MongoMemoryOptions): EphemeralService {
  const envName = options.env ?? 'MONGODB_URI'

  return {
    name: 'MongoDB memory server',
    port: options.port,
    async start(ctx) {
      const resolvedPort = await ctx.resolvePort('mongodb', options.port, {
        envVar: 'DB_PORT',
        defaultBase: 15_000,
        defaultRange: 5000
      })
      const server = await MongoMemoryServer.create({
        instance: {
          ip: '127.0.0.1',
          port: resolvedPort.port
        },
        binary: options.version ? { version: options.version } : undefined
      })
      const uri = server.getUri()
      const seeded = await seedMongo({
        uri,
        cwd: ctx.cwd,
        seedDir: options.seedDir
      })

      return {
        name: 'MongoDB memory server',
        env: {
          [envName]: uri
        },
        metadata: {
          uri,
          env: envName
        },
        seeded,
        async stop() {
          await server.stop()
        }
      }
    }
  }
}
