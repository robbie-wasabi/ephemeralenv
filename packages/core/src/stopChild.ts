import type { ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const STOP_TIMEOUT_MS = 5000
const POLL_INTERVAL_MS = 100

export const usesProcessGroups = process.platform !== 'win32'

export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return
  }

  if (usesProcessGroups && signalProcessGroup(child.pid, signal)) {
    return
  }

  child.kill(signal)
}

export async function stopChild(child: ChildProcess, exited: Promise<void>): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) {
    return
  }

  if (!usesProcessGroups) {
    child.kill('SIGTERM')

    const exitedInTime = await Promise.race([
      exited.then(() => true),
      delay(STOP_TIMEOUT_MS, false, { ref: false })
    ])

    if (!exitedInTime) {
      child.kill('SIGKILL')
      await exited
    }

    return
  }

  if (!signalProcessGroup(child.pid, 'SIGTERM')) {
    return
  }

  const killDeadline = Date.now() + STOP_TIMEOUT_MS

  while (processGroupAlive(child.pid)) {
    if (Date.now() >= killDeadline) {
      signalProcessGroup(child.pid, 'SIGKILL')
      break
    }

    await delay(POLL_INTERVAL_MS)
  }

  await exited
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    return false
  }
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}
