import { describe, expect, test } from 'vitest'
import { cleanProcessEnv } from '../src/env.js'
import { runCommand } from '../src/runCommand.js'

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
})
