import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createCleanup } from '../src/lifecycle.js'
import { mergeRuntimeEnv, readEnvFile } from '../src/env.js'
import { interpolate } from '../src/interpolate.js'
import { createPortResolver, getFreePort, PortUnavailableError, preferredPort } from '../src/ports.js'

describe('ports', () => {
  test('maps the same seed to the same preferred port', () => {
    const config = { base: 10_000, range: 5000 }

    expect(preferredPort('my-app:/tmp/app:app', config)).toBe(preferredPort('my-app:/tmp/app:app', config))
  })

  test('explicit port overrides generated ports', async () => {
    const port = await getFreePort()
    const resolvePort = createPortResolver({
      namespace: 'test',
      environmentKey: 'env',
      env: { APP_PORT: String(port) }
    })

    await expect(resolvePort('app', { base: 10_000, range: 5000 }, { envVar: 'APP_PORT' })).resolves.toMatchObject({
      port,
      explicit: true
    })
  })

  test('occupied explicit ports fail loudly', async () => {
    const port = await getFreePort()
    const server = await listen(port)
    const resolvePort = createPortResolver({
      namespace: 'test',
      environmentKey: 'env',
      env: { APP_PORT: String(port) }
    })

    await expect(resolvePort('app', { base: 10_000, range: 5000 }, { envVar: 'APP_PORT' })).rejects.toBeInstanceOf(
      PortUnavailableError
    )

    await close(server)
  })

  test('occupied preferred ports fall back when not explicit', async () => {
    const preferred = await getFreePort()
    const server = await listen(preferred)
    const resolvePort = createPortResolver({
      namespace: 'test',
      environmentKey: 'env',
      env: {}
    })

    const resolved = await resolvePort('app', { base: preferred, range: 1 }, { envVar: 'APP_PORT' })

    expect(resolved.preferredPort).toBe(preferred)
    expect(resolved.port).not.toBe(preferred)
    expect(resolved.explicit).toBe(false)

    await close(server)
  })
})

describe('environment helpers', () => {
  test('loads .env.ephm by default', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-env-'))
    await writeFile(join(cwd, '.env.ephm'), 'DATABASE_URL=postgresql://local\n')

    expect(readEnvFile(cwd)).toMatchObject({
      exists: true,
      values: { DATABASE_URL: 'postgresql://local' }
    })
  })

  test('falls back to .env.ephemeral by default', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-env-'))
    await writeFile(join(cwd, '.env.ephemeral'), 'MONGODB_URI=mongodb://local\n')

    expect(readEnvFile(cwd)).toMatchObject({
      exists: true,
      values: { MONGODB_URI: 'mongodb://local' }
    })
  })

  test('interpolates bare and braced variables', () => {
    expect(interpolate('http://localhost:$APP_PORT/${PATH_PART}', { APP_PORT: '3100', PATH_PART: 'health' })).toBe(
      'http://localhost:3100/health'
    )
  })

  test('generated env overrides env files and process env remains highest precedence', () => {
    expect(
      mergeRuntimeEnv({
        envFile: { DATABASE_URL: 'postgresql://placeholder', KEEP: 'env-file' },
        generated: { DATABASE_URL: 'postgresql://generated', APP_PORT: '3100' },
        processEnv: { KEEP: 'process' }
      })
    ).toEqual({
      DATABASE_URL: 'postgresql://generated',
      APP_PORT: '3100',
      KEEP: 'process'
    })
  })
})

describe('cleanup', () => {
  test('runs cleanup tasks only once', async () => {
    let calls = 0
    const cleanup = createCleanup([
      async () => {
        calls += 1
      }
    ])

    await Promise.all([cleanup(), cleanup(), cleanup()])

    expect(calls).toBe(1)
  })
})

async function listen(port: number): Promise<Server> {
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })

  return server
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}
