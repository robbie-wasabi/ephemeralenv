import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { BSON, MongoClient } from 'mongodb'
import type { SeedSummary } from 'ephemeralenv'

export type MongoSeedOptions = {
  uri: string
  cwd: string
  seedDir?: string
}

export type MongoSeedFile = {
  collectionName: string
  docs: Record<string, unknown>[]
}

export async function seedMongo(options: MongoSeedOptions): Promise<SeedSummary[]> {
  const seedFiles = await readMongoSeedFiles(options.cwd, options.seedDir)
  if (seedFiles.length === 0) {
    return []
  }

  const client = new MongoClient(options.uri)
  await client.connect()

  try {
    const db = client.db()
    const summaries: SeedSummary[] = []

    for (const { collectionName, docs } of seedFiles) {
      if (docs.length > 0) {
        await db.collection(collectionName).insertMany(docs)
      }

      summaries.push({
        label: collectionName,
        count: docs.length,
        unit: docs.length === 1 ? 'doc' : 'docs'
      })
    }

    return summaries
  } finally {
    await client.close()
  }
}

export async function readMongoSeedFiles(cwd: string, seedDir?: string): Promise<MongoSeedFile[]> {
  if (!seedDir) {
    return []
  }

  const dir = resolve(cwd, seedDir)
  if (!existsSync(dir)) {
    return []
  }

  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const seedFiles: MongoSeedFile[] = []

  for (const file of files) {
    const filePath = resolve(dir, file)
    const collectionName = basename(file, '.json')
    const raw = await readFile(filePath, 'utf8')
    let docs: unknown

    try {
        docs = BSON.EJSON.parse(raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Malformed Mongo seed JSON in ${file}: ${message}`)
    }

    if (!Array.isArray(docs)) {
      throw new Error(`Malformed Mongo seed JSON in ${file}: expected a top-level array`)
    }

    seedFiles.push({
      collectionName,
      docs: docs as Record<string, unknown>[]
    })
  }

  return seedFiles
}
