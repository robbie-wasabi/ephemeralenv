import { spawn } from 'node:child_process'
import { quoteCommand } from './logger.js'
import type { CommandConfig } from './service.js'

export async function runCommand(options: {
  command: CommandConfig
  cwd: string
  env: Record<string, string>
}): Promise<void> {
  const [command, ...args] = options.command

  if (!command) {
    throw new Error('beforeApp command must include a command name')
  }

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit'
  })

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed: ${quoteCommand(options.command)} (${formatExit(code, signal)})`))
    })
  })
}

function formatExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (typeof code === 'number') {
    return `exit ${code}`
  }

  return signal ? `signal ${signal}` : 'unknown exit'
}
