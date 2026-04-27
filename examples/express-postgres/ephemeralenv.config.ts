import { defineConfig } from 'ephemeralenv'
import { pglite } from 'ephemeralenv-postgres'

export default defineConfig({
  envFile: '.env.ephm',
  namespace: 'express-postgres-example',
  app: {
    command: 'pnpm',
    args: ['exec', 'tsx', 'src/server.ts', '--port', '$APP_PORT'],
    port: { base: 10_000, range: 5000 },
    env: {
      SITE_URL: 'http://localhost:$APP_PORT'
    }
  },
  services: [
    pglite({
      env: 'DATABASE_URL',
      port: { base: 16_000, range: 5000 },
      sqlDir: 'data/seeds/postgres'
    })
  ]
})
