import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { acquireEnvironmentSlot, acquireSlot, parseMaxProcesses, SlotLimitError } from '../src/slots.js'

async function makeSlotDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ephemeralenv-slots-'))
}

function deadPid(): number {
  const result = spawnSync(process.execPath, ['-e', ''])
  if (result.error || result.pid === undefined) {
    throw new Error('Unable to spawn a short-lived process for a dead pid')
  }

  return result.pid
}

describe('parseMaxProcesses', () => {
  test('returns undefined when unset or empty', () => {
    expect(parseMaxProcesses(undefined)).toBeUndefined()
    expect(parseMaxProcesses('')).toBeUndefined()
  })

  test('parses positive integers', () => {
    expect(parseMaxProcesses('3')).toBe(3)
  })

  test('rejects non-integers and non-positive values', () => {
    expect(() => parseMaxProcesses('0')).toThrow('EPHEMERAL_ENV_MAX_PROCESSES')
    expect(() => parseMaxProcesses('-1')).toThrow('EPHEMERAL_ENV_MAX_PROCESSES')
    expect(() => parseMaxProcesses('2.5')).toThrow('EPHEMERAL_ENV_MAX_PROCESSES')
    expect(() => parseMaxProcesses('lots')).toThrow('EPHEMERAL_ENV_MAX_PROCESSES')
  })
})

describe('acquireEnvironmentSlot', () => {
  test('is a no-op when EPHEMERAL_ENV_MAX_PROCESSES is unset', async () => {
    const dir = await makeSlotDir()
    const slot = await acquireEnvironmentSlot({ env: {}, environmentId: 'app:/tmp/app', dir })

    expect(slot.slot).toBeUndefined()
    await slot.release()
    await expect(readdir(dir)).resolves.toEqual([])
  })

  test('claims a slot when EPHEMERAL_ENV_MAX_PROCESSES is set', async () => {
    const dir = await makeSlotDir()
    const slot = await acquireEnvironmentSlot({
      env: { EPHEMERAL_ENV_MAX_PROCESSES: '2' },
      environmentId: 'app:/tmp/app',
      dir
    })

    expect(slot.slot).toBe(0)
    await expect(readdir(dir)).resolves.toEqual(['slot-0'])
    await slot.release()
    await expect(readdir(dir)).resolves.toEqual([])
  })
})

describe('acquireSlot', () => {
  test('assigns distinct slots up to the limit', async () => {
    const dir = await makeSlotDir()
    const first = await acquireSlot({ limit: 2, environmentId: 'a', dir })
    const second = await acquireSlot({ limit: 2, environmentId: 'b', dir })

    expect(first.slot).toBe(0)
    expect(second.slot).toBe(1)

    await first.release()
    await second.release()
  })

  test('fails at capacity and names the holders', async () => {
    const dir = await makeSlotDir()
    const held = await acquireSlot({ limit: 1, environmentId: 'app:/tmp/feature-a', dir })

    const error = await acquireSlot({ limit: 1, environmentId: 'app:/tmp/feature-b', dir }).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(SlotLimitError)
    expect((error as Error).message).toContain('app:/tmp/feature-a')
    expect((error as Error).message).toContain(`pid ${process.pid}`)

    await held.release()
  })

  test('reclaims slots whose owner is no longer running', async () => {
    const dir = await makeSlotDir()
    await writeFile(join(dir, 'slot-0'), JSON.stringify({ pid: deadPid(), environmentId: 'crashed' }))

    const slot = await acquireSlot({ limit: 1, environmentId: 'fresh', dir })

    expect(slot.slot).toBe(0)
    await expect(readFile(join(dir, 'slot-0'), 'utf8')).resolves.toContain('fresh')

    await slot.release()
  })

  test('treats unreadable slot files as occupied', async () => {
    const dir = await makeSlotDir()
    await writeFile(join(dir, 'slot-0'), 'not json')

    await expect(acquireSlot({ limit: 1, environmentId: 'fresh', dir })).rejects.toBeInstanceOf(SlotLimitError)
  })

  test('release leaves slots owned by other processes alone', async () => {
    const dir = await makeSlotDir()
    const slot = await acquireSlot({ limit: 1, environmentId: 'mine', dir })
    await writeFile(slot.path!, JSON.stringify({ pid: process.pid + 1, environmentId: 'theirs' }))

    await slot.release()

    expect(existsSync(slot.path!)).toBe(true)
  })
})
