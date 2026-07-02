import { getFreePort } from 'ephemeralenv'
import type { ServiceContext, ServiceStartResult } from 'ephemeralenv'
import { Client } from 'pg'
import { afterEach, describe, expect, test } from 'vitest'
import { pglite } from '../src/pglite.js'

async function startService(): Promise<ServiceStartResult> {
  const port = await getFreePort()
  const service = pglite({ port: { base: port, range: 1 } })
  const ctx: ServiceContext = {
    cwd: process.cwd(),
    namespace: 'pglite-test',
    environmentId: 'pglite-test:local',
    env: {},
    resolvePort: async (name, config) => ({
      name,
      port: config.base,
      preferredPort: config.base,
      explicit: true
    })
  }

  return await service.start(ctx)
}

describe('pglite service', () => {
  let started: ServiceStartResult | undefined

  afterEach(async () => {
    await started?.stop()
    started = undefined
  })

  test('emits a connection URL that is usable as-is (sslmode=disable baked in)', async () => {
    started = await startService()

    const url = started.env.DATABASE_URL
    expect(url).toContain('sslmode=disable')
    expect(started.metadata?.url).toBe(url)

    // A client using the URL verbatim — no extra decoration — must connect.
    const client = new Client({ connectionString: url })
    await client.connect()
    const result = await client.query('select 1 as one')
    expect(result.rows).toEqual([{ one: 1 }])
    await client.end()
  })

  test('serves concurrent connections (Prisma pools open more than one)', async () => {
    started = await startService()
    const url = started.env.DATABASE_URL

    const clients = Array.from({ length: 4 }, () => new Client({ connectionString: url }))
    await Promise.all(clients.map((client) => client.connect()))

    const results = await Promise.all(
      clients.map((client, index) => client.query(`select ${index} as n`))
    )
    expect(results.map((result) => result.rows[0].n)).toEqual([0, 1, 2, 3])

    await Promise.all(clients.map((client) => client.end()))
  })
})
