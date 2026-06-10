import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type EnvironmentSlot = {
  slot?: number
  path?: string
  release: () => Promise<void>
}

export type SlotHolder = {
  slot: number
  pid?: number
  environmentId?: string
}

export class SlotLimitError extends Error {
  constructor(limit: number, holders: SlotHolder[]) {
    const active = holders.map(describeHolder).join(', ')
    super(
      `EPHEMERAL_ENV_MAX_PROCESSES limit of ${limit} reached; active: ${active}. Stop an environment or raise EPHEMERAL_ENV_MAX_PROCESSES.`
    )
    this.name = 'SlotLimitError'
  }
}

export function defaultSlotDir(): string {
  return join(homedir(), '.ephemeralenv', 'slots')
}

export function parseMaxProcesses(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }

  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('EPHEMERAL_ENV_MAX_PROCESSES must be a positive integer')
  }

  return limit
}

export async function acquireEnvironmentSlot(options: {
  env: Record<string, string>
  environmentId: string
  dir?: string
}): Promise<EnvironmentSlot> {
  const limit = parseMaxProcesses(options.env.EPHEMERAL_ENV_MAX_PROCESSES)

  if (limit === undefined) {
    return { release: async () => {} }
  }

  return await acquireSlot({
    limit,
    environmentId: options.environmentId,
    dir: options.dir ?? options.env.EPHEMERAL_ENV_SLOT_DIR
  })
}

export async function acquireSlot(options: {
  limit: number
  environmentId: string
  dir?: string
}): Promise<EnvironmentSlot> {
  const dir = options.dir ?? defaultSlotDir()
  await mkdir(dir, { recursive: true })

  const payload = JSON.stringify({
    pid: process.pid,
    environmentId: options.environmentId
  })
  const holders: SlotHolder[] = []

  for (let slot = 0; slot < options.limit; slot++) {
    const path = join(dir, `slot-${slot}`)

    if (await tryClaim(path, payload)) {
      return createHandle(slot, path)
    }

    const holder = await readSlotHolder(path)

    if (holder === undefined) {
      // The file vanished between claim and read; race once more for it.
      if (await tryClaim(path, payload)) {
        return createHandle(slot, path)
      }

      holders.push({ slot })
      continue
    }

    if (holder.pid !== undefined && !isPidAlive(holder.pid)) {
      if ((await removeStaleSlot(dir, slot, path)) && (await tryClaim(path, payload))) {
        return createHandle(slot, path)
      }
    }

    holders.push({ slot, ...holder })
  }

  throw new SlotLimitError(options.limit, holders)
}

function createHandle(slot: number, path: string): EnvironmentSlot {
  return {
    slot,
    path,
    async release() {
      try {
        const holder = await readSlotHolder(path)
        if (holder?.pid === process.pid) {
          await rm(path, { force: true })
        }
      } catch {
        // Releasing is best-effort; stale slots are reclaimed by later runs.
      }
    }
  }
}

async function tryClaim(path: string, payload: string): Promise<boolean> {
  try {
    await writeFile(path, payload, { flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }

    throw error
  }
}

async function readSlotHolder(path: string): Promise<Omit<SlotHolder, 'slot'> | undefined> {
  let raw: string

  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const { pid, environmentId } = parsed as Record<string, unknown>
      return {
        pid: typeof pid === 'number' ? pid : undefined,
        environmentId: typeof environmentId === 'string' ? environmentId : undefined
      }
    }
  } catch {
    // Unreadable contents: treat the slot as occupied by an unknown owner
    // rather than reclaiming a file another process may be mid-claiming.
  }

  return {}
}

async function removeStaleSlot(dir: string, slot: number, path: string): Promise<boolean> {
  // rename is atomic, so concurrent reclaimers cannot both win the slot.
  const tombstone = join(dir, `slot-${slot}.stale-${process.pid}`)

  try {
    await rename(path, tombstone)
  } catch {
    return false
  }

  await rm(tombstone, { force: true })
  return true
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function describeHolder(holder: SlotHolder): string {
  const id = holder.environmentId ?? 'unknown environment'
  const pid = holder.pid !== undefined ? ` (pid ${holder.pid})` : ''
  return `${id}${pid}`
}
