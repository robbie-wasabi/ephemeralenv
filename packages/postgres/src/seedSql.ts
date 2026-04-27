import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import type { SeedSummary } from '@ephemeralenv/core'

export type SqlSeedOptions = {
  db: PGlite
  cwd: string
  sqlDir?: string
}

export async function seedSql(options: SqlSeedOptions): Promise<SeedSummary[]> {
  if (!options.sqlDir) {
    return []
  }

  const dir = resolve(options.cwd, options.sqlDir)
  if (!existsSync(dir)) {
    return []
  }

  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  for (const file of files) {
    const sql = await readFile(resolve(dir, file), 'utf8')

    try {
      await options.db.exec(sql)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to execute SQL seed ${file}: ${message}`)
    }
  }

  return files.map((file) => ({
    label: file,
    count: 1,
    unit: 'file'
  }))
}
