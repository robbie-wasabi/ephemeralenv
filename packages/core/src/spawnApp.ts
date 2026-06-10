import { spawn, type ChildProcess } from 'node:child_process'
import { killTree, stopChild, usesProcessGroups } from './stopChild.js'

export type SpawnedApp = {
  child: ChildProcess
  exit: Promise<number>
  stop: () => Promise<void>
  forceKill: () => void
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
    stdio: 'inherit',
    detached: usesProcessGroups
  })

  let settled = false

  const exit = new Promise<number>((resolve, reject) => {
    child.once('error', (error) => {
      settled = true
      reject(error)
    })
    child.once('exit', (code, signal) => {
      settled = true
      if (typeof code === 'number') {
        resolve(code)
        return
      }

      resolve(signalToExitCode(signal))
    })
  })
  const exited = exit.then(
    () => undefined,
    () => undefined
  )

  return {
    child,
    exit,
    forceKill() {
      killTree(child, 'SIGKILL')
    },
    async stop() {
      if (settled) {
        return
      }

      await stopChild(child, exited)
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
