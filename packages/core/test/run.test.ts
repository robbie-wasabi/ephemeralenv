import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { run } from '../src/run.js'

const OVERRIDE_ENV = 'EPHEMERALENV_TEST_OVERRIDE'
const MUTATED_ENV_VARS = [OVERRIDE_ENV, 'EPHEMERAL_ENV_MAX_PROCESSES', 'EPHEMERAL_ENV_SLOT_DIR'] as const

describe('run', () => {
  const originalEnv = Object.fromEntries(MUTATED_ENV_VARS.map((name) => [name, process.env[name]]))

  afterEach(() => {
    for (const name of MUTATED_ENV_VARS) {
      if (originalEnv[name] === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = originalEnv[name]
      }
    }
  })

  test('starts services, runs beforeApp, starts the app, and cleans up in order', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-run-'))
    const configPath = join(cwd, 'ephemeralenv.config.mjs')
    const logPath = join(cwd, 'order.log')
    const lines: string[] = []

    process.env[OVERRIDE_ENV] = 'shell'

    await writeFile(configPath, configSource({ logPath }))

    const exitCode = await run({
      cwd,
      configPath,
      logger: {
        line(message = '') {
          lines.push(message)
        }
      }
    })

    await expect(readFile(logPath, 'utf8')).resolves.toBe(
      ['service:start', 'before:generated:shell', 'app:generated:shell', 'service:stop', ''].join('\n')
    )
    expect(exitCode).toBe(0)
    expect(lines).toContain('Warnings:')
    expect(lines).toContain(`  existing process env ${OVERRIDE_ENV} overrides generated service value`)
  })

  test('fails fast when EPHEMERAL_ENV_MAX_PROCESSES slots are all taken', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-run-'))
    const slotDir = await mkdtemp(join(tmpdir(), 'ephemeralenv-run-slots-'))
    const configPath = join(cwd, 'ephemeralenv.config.mjs')

    await writeFile(configPath, minimalConfigSource())
    await writeFile(join(slotDir, 'slot-0'), JSON.stringify({ pid: process.pid, environmentId: 'other-env' }))

    process.env.EPHEMERAL_ENV_MAX_PROCESSES = '1'
    process.env.EPHEMERAL_ENV_SLOT_DIR = slotDir

    await expect(run({ cwd, configPath, logger: { line() {} } })).rejects.toThrow(/EPHEMERAL_ENV_MAX_PROCESSES.*other-env/)
  })

  test('claims a slot for the run and releases it on exit', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-run-'))
    const slotDir = await mkdtemp(join(tmpdir(), 'ephemeralenv-run-slots-'))
    const configPath = join(cwd, 'ephemeralenv.config.mjs')

    await writeFile(configPath, minimalConfigSource())

    process.env.EPHEMERAL_ENV_MAX_PROCESSES = '1'
    process.env.EPHEMERAL_ENV_SLOT_DIR = slotDir

    const exitCode = await run({ cwd, configPath, logger: { line() {} } })

    expect(exitCode).toBe(0)
    await expect(readdir(slotDir)).resolves.toEqual([])
  })

  test('releases the slot when startup fails', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-run-'))
    const slotDir = await mkdtemp(join(tmpdir(), 'ephemeralenv-run-slots-'))
    const configPath = join(cwd, 'ephemeralenv.config.mjs')

    await writeFile(configPath, failingServiceConfigSource())

    process.env.EPHEMERAL_ENV_MAX_PROCESSES = '1'
    process.env.EPHEMERAL_ENV_SLOT_DIR = slotDir

    await expect(run({ cwd, configPath, logger: { line() {} } })).rejects.toThrow('service exploded')
    await expect(readdir(slotDir)).resolves.toEqual([])
  })

  test('runs services + beforeApp without an app and holds open until interrupted', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-run-'))
    const configPath = join(cwd, 'ephemeralenv.config.mjs')
    const logPath = join(cwd, 'order.log')
    const lines: string[] = []

    await writeFile(configPath, backendOnlyConfigSource({ logPath }))

    const controller = new AbortController()
    const runPromise = run({
      cwd,
      configPath,
      signal: controller.signal,
      logger: {
        line(message = '') {
          lines.push(message)
        }
      }
    })
    // Abort triggers a graceful shutdown once startup + beforeApp complete.
    controller.abort()

    const exitCode = await runPromise

    expect(exitCode).toBe(0)
    await expect(readFile(logPath, 'utf8')).resolves.toBe(['service:start', 'before:ran', 'service:stop', ''].join('\n'))
    expect(lines).toContain('  (none — services-only mode)')
    expect(lines).toContain('services ready; holding open until interrupted (Ctrl-C to stop)')
  })
})

function minimalConfigSource(): string {
  return `
    export default {
      namespace: 'run-test',
      app: {
        command: ${JSON.stringify(process.execPath)},
        args: ['-e', ''],
        port: { base: 12_000, range: 5000 }
      }
    }
  `
}

function failingServiceConfigSource(): string {
  return `
    export default {
      namespace: 'run-test',
      app: {
        command: ${JSON.stringify(process.execPath)},
        args: ['-e', ''],
        port: { base: 12_000, range: 5000 }
      },
      services: [
        {
          name: 'Broken service',
          async start() {
            throw new Error('service exploded')
          }
        }
      ]
    }
  `
}

function backendOnlyConfigSource(options: { logPath: string }): string {
  const beforeAppScript = `
    const { appendFileSync } = require('node:fs')
    if (process.env.EPHEMERALENV_TEST_MARKER !== 'generated') process.exit(2)
    appendFileSync(${JSON.stringify(options.logPath)}, 'before:ran\\n')
  `

  return `
    export default {
      namespace: 'run-test',
      beforeApp: [
        [${JSON.stringify(process.execPath)}, '-e', ${JSON.stringify(beforeAppScript)}]
      ],
      services: [
        {
          name: 'Fake service',
          async start() {
            const { appendFileSync } = await import('node:fs')
            appendFileSync(${JSON.stringify(options.logPath)}, 'service:start\\n')
            return {
              name: 'Fake service',
              env: { EPHEMERALENV_TEST_MARKER: 'generated' },
              async stop() {
                const { appendFileSync } = await import('node:fs')
                appendFileSync(${JSON.stringify(options.logPath)}, 'service:stop\\n')
              }
            }
          }
        }
      ]
    }
  `
}

function configSource(options: { logPath: string }): string {
  const beforeAppScript = `
    const { appendFileSync } = require('node:fs')
    if (process.env.EPHEMERALENV_TEST_MARKER !== 'generated') process.exit(2)
    if (process.env.${OVERRIDE_ENV} !== 'shell') process.exit(3)
    appendFileSync(${JSON.stringify(options.logPath)}, 'before:' + process.env.EPHEMERALENV_TEST_MARKER + ':' + process.env.${OVERRIDE_ENV} + '\\n')
  `
  const appScript = `
    const { appendFileSync } = require('node:fs')
    if (process.env.EPHEMERALENV_TEST_MARKER !== 'generated') process.exit(4)
    if (process.env.${OVERRIDE_ENV} !== 'shell') process.exit(5)
    appendFileSync(${JSON.stringify(options.logPath)}, 'app:' + process.env.EPHEMERALENV_TEST_MARKER + ':' + process.env.${OVERRIDE_ENV} + '\\n')
  `

  return `
    import { appendFileSync } from 'node:fs'

    export default {
      namespace: 'run-test',
      beforeApp: [
        [${JSON.stringify(process.execPath)}, '-e', ${JSON.stringify(beforeAppScript)}]
      ],
      app: {
        command: ${JSON.stringify(process.execPath)},
        args: ['-e', ${JSON.stringify(appScript)}],
        port: { base: 12_000, range: 5000 }
      },
      services: [
        {
          name: 'Fake service',
          async start() {
            appendFileSync(${JSON.stringify(options.logPath)}, 'service:start\\n')
            return {
              name: 'Fake service',
              env: {
                EPHEMERALENV_TEST_MARKER: 'generated',
                ${OVERRIDE_ENV}: 'generated'
              },
              async stop() {
                appendFileSync(${JSON.stringify(options.logPath)}, 'service:stop\\n')
              }
            }
          }
        }
      ]
    }
  `
}
