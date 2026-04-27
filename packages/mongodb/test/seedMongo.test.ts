import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ObjectId } from 'mongodb'
import { describe, expect, test } from 'vitest'
import { readMongoSeedFiles } from '../src/seedMongo.js'

describe('readMongoSeedFiles', () => {
  test('maps JSON filenames to collection names and parses Mongo EJSON', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-mongo-'))
    const seedDir = 'seeds'
    await mkdir(join(cwd, seedDir))
    await writeFile(join(cwd, seedDir, 'users.json'), JSON.stringify([
      {
        _id: { $oid: '6877e615628074e008b7628f' },
        createdAt: { $date: '2026-01-01T00:00:00.000Z' },
        email: 'admin@example.com'
      }
    ]))
    await writeFile(join(cwd, seedDir, 'accounts.json'), '[]')

    const files = await readMongoSeedFiles(cwd, seedDir)

    expect(files.map((file) => file.collectionName)).toEqual(['accounts', 'users'])
    expect(files[1]?.docs[0]?._id).toBeInstanceOf(ObjectId)
    expect(files[1]?.docs[0]?.createdAt).toBeInstanceOf(Date)
  })

  test('rejects seed files without a top-level array', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-mongo-'))
    const seedDir = 'seeds'
    await mkdir(join(cwd, seedDir))
    await writeFile(join(cwd, seedDir, 'users.json'), '{"email":"admin@example.com"}')

    await expect(readMongoSeedFiles(cwd, seedDir)).rejects.toThrow('expected a top-level array')
  })
})
