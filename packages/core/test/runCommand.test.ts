import { access, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { cleanProcessEnv } from '../src/env.js'
import { runCommand, spawnCommand } from '../src/runCommand.js'

describe('runCommand', () => {
  test('runs commands with the provided environment', async () => {
    await expect(
      runCommand({
        command: [
          process.execPath,
          '-e',
          'if (process.env.EPHEMERALENV_TEST_VALUE !== "ok") process.exit(2)'
        ],
        cwd: process.cwd(),
        env: {
          ...cleanProcessEnv(),
          EPHEMERALENV_TEST_VALUE: 'ok'
        }
      })
    ).resolves.toBeUndefined()
  })

  test('rejects when a command exits nonzero', async () => {
    await expect(
      runCommand({
        command: [process.execPath, '-e', 'process.exit(7)'],
        cwd: process.cwd(),
        env: cleanProcessEnv()
      })
    ).rejects.toThrow('exit 7')
  })

  test('stops a running command with SIGTERM', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-command-'))
    const readyPath = join(cwd, 'ready.txt')
    const terminatedPath = join(cwd, 'terminated.txt')
    const command = spawnCommand({
      command: [
        process.execPath,
        '-e',
        `
          const { writeFileSync } = require('node:fs')
          writeFileSync(${JSON.stringify(readyPath)}, 'ready')
          process.on('SIGTERM', () => {
            writeFileSync(${JSON.stringify(terminatedPath)}, 'terminated')
            process.exit(0)
          })
          setInterval(() => {}, 1000)
        `
      ],
      cwd,
      env: cleanProcessEnv()
    })

    await waitForFile(readyPath)
    await command.stop()

    await expect(command.exit).resolves.toBeUndefined()
    await expect(readFile(terminatedPath, 'utf8')).resolves.toBe('terminated')
  })
})

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5000

  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  throw new Error(`Timed out waiting for ${path}`)
}
