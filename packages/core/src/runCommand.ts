import { spawn } from 'node:child_process'
import { quoteCommand } from './logger.js'
import type { CommandConfig } from './service.js'
import { killTree, stopChild, usesProcessGroups } from './stopChild.js'

export type SpawnedCommand = {
  exit: Promise<void>
  stop: () => Promise<void>
  forceKill: () => void
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
    stdio: 'inherit',
    detached: usesProcessGroups
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
  const exited = exit.then(
    () => undefined,
    () => undefined
  )

  return {
    exit,
    forceKill() {
      stopping = true
      killTree(child, 'SIGKILL')
    },
    async stop() {
      if (settled) {
        return
      }

      stopping = true
      await stopChild(child, exited)
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
