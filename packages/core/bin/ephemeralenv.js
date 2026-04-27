#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const distCli = resolve(here, '../dist/cli.js')
const sourceCli = resolve(here, '../src/cli.ts')

if (existsSync(distCli)) {
  await import(pathToFileURL(distCli).href)
} else if (existsSync(sourceCli)) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', sourceCli, ...process.argv.slice(2)], {
    env: process.env,
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  process.exit(result.status ?? signalToExitCode(result.signal))
} else {
  console.error('ephemeralenv: build output not found. Run `pnpm --filter ephemeralenv build`.')
  process.exit(1)
}

function signalToExitCode(signal) {
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
