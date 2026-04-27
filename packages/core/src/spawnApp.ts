import { spawn, type ChildProcess } from 'node:child_process'

export type SpawnedApp = {
  child: ChildProcess
  exit: Promise<number>
  stop: () => Promise<void>
}

export function spawnApp(options: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}): SpawnedApp {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit'
  })

  let settled = false

  const exit = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      settled = true
      if (typeof code === 'number') {
        resolve(code)
        return
      }

      resolve(signalToExitCode(signal))
    })
  })

  return {
    child,
    exit,
    async stop() {
      if (settled || child.exitCode !== null || child.killed) {
        return
      }

      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          if (!settled && child.exitCode === null) {
            child.kill('SIGKILL')
          }
        }, 5000)

        child.once('exit', () => {
          clearTimeout(killTimer)
          resolve()
        })

        child.kill('SIGTERM')
      })
    }
  }
}

function signalToExitCode(signal: NodeJS.Signals | null): number {
  switch (signal) {
    case 'SIGINT':
      return 130
    case 'SIGTERM':
      return 143
    case 'SIGHUP':
      return 129
    default:
      return 1
  }
}
