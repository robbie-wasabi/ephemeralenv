import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { describe, expect, test } from 'vitest'
import { seedSql } from '../src/seedSql.js'

describe('seedSql', () => {
  test('executes SQL files in lexical order', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-sql-'))
    const sqlDir = 'sql'
    const executed: string[] = []
    await mkdir(join(cwd, sqlDir))
    await writeFile(join(cwd, sqlDir, '002_data.sql'), 'insert into users values (1);')
    await writeFile(join(cwd, sqlDir, '001_schema.sql'), 'create table users (id int);')
    await writeFile(join(cwd, sqlDir, 'notes.txt'), 'ignored')

    const summaries = await seedSql({
      cwd,
      sqlDir,
      db: {
        exec: async (sql: string) => {
          executed.push(sql)
        }
      } as unknown as PGlite
    })

    expect(executed).toEqual(['create table users (id int);', 'insert into users values (1);'])
    expect(summaries.map((summary) => summary.label)).toEqual(['001_schema.sql', '002_data.sql'])
  })

  test('includes the SQL filename when execution fails', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ephemeralenv-sql-'))
    const sqlDir = 'sql'
    await mkdir(join(cwd, sqlDir))
    await writeFile(join(cwd, sqlDir, '001_bad.sql'), 'bad sql')

    await expect(
      seedSql({
        cwd,
        sqlDir,
        db: {
          exec: async () => {
            throw new Error('syntax error')
          }
        } as unknown as PGlite
      })
    ).rejects.toThrow('001_bad.sql')
  })
})
