import { defineConfig } from '@ephemeralenv/core'
import { mongoMemory } from '@ephemeralenv/mongodb'

export default defineConfig({
  envFile: '.env.ephm',
  namespace: 'express-mongodb-example',
  app: {
    command: 'pnpm',
    args: ['exec', 'tsx', 'src/server.ts', '--port', '$APP_PORT'],
    port: { base: 10_000, range: 5000 },
    env: {
      SITE_URL: 'http://localhost:$APP_PORT'
    }
  },
  services: [
    mongoMemory({
      env: 'MONGODB_URI',
      port: { base: 15_000, range: 5000 },
      seedDir: 'data/seeds/mongo'
    })
  ]
})
