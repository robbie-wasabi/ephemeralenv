#!/usr/bin/env node
import { run } from './run.js'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`ephemeralenv

Usage:
  ephemeralenv [--config path]

Environment:
  EPHEMERAL_ENV_ID  Stable id used for deterministic ports.
  APP_PORT          Explicit app port.
  DB_PORT           Explicit database service port.
`)
  process.exit(0)
}

const configIndex = args.findIndex((arg) => arg === '--config' || arg === '-c')
const configPath = configIndex >= 0 ? args[configIndex + 1] : undefined

if (configIndex >= 0 && !configPath) {
  console.error('ephemeralenv: --config requires a path')
  process.exit(1)
}

run({ configPath })
  .then((code) => {
    process.exit(code)
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`ephemeralenv: ${message}`)

    if (process.env.DEBUG && error instanceof Error && error.stack) {
      console.error(error.stack)
    }

    process.exit(1)
  })
