import { spawn } from 'node:child_process'
import { quoteCommand } from './logger.js'
import type { CommandConfig } from './service.js'

const COMMAND_STOP_TIMEOUT_MS = 5000

export type SpawnedCommand = {
  exit: Promise<void>
  stop: () => Promise<void>
}

export function spawnCommand(options: {
  command: CommandConfig
  cwd: string
  env: Record<string, string>
}): SpawnedCommand {
  const [command, ...args] = options.command

  if (!command) {
    throw new Error('beforeApp command must include a command name')
  }

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit'
  })

  let settled = false
  let stopping = false

  const exit = new Promise<void>((resolve, reject) => {
    child.once('error', (error) => {
      settled = true
      reject(error)
    })
    child.once('exit', (code, signal) => {
      settled = true
      if (code === 0 || stopping) {
        resolve()
        return
      }

      reject(new Error(`Command failed: ${quoteCommand(options.command)} (${formatExit(code, signal)})`))
    })
  })

  return {
    exit,
    async stop() {
      if (settled || child.exitCode !== null || child.killed) {
        return
      }

      stopping = true

      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          if (!settled && child.exitCode === null) {
            child.kill('SIGKILL')
          }
        }, COMMAND_STOP_TIMEOUT_MS)

        child.once('exit', () => {
          clearTimeout(killTimer)
          resolve()
        })

        child.kill('SIGTERM')
      })
    }
  }
}

export async function runCommand(options: {
  command: CommandConfig
  cwd: string
  env: Record<string, string>
}): Promise<void> {
  await spawnCommand(options).exit
}

function formatExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (typeof code === 'number') {
    return `exit ${code}`
  }

  return signal ? `signal ${signal}` : 'unknown exit'
}
