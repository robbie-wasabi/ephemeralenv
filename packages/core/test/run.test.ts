import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { run } from '../src/run.js'

const OVERRIDE_ENV = 'EPHEMERALENV_TEST_OVERRIDE'

describe('run', () => {
  const originalOverride = process.env[OVERRIDE_ENV]

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env[OVERRIDE_ENV]
    } else {
      process.env[OVERRIDE_ENV] = originalOverride
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
})

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
