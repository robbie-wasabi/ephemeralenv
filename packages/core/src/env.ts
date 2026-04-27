import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'

export type LoadedEnvFile = {
  path: string
  exists: boolean
  values: Record<string, string>
}

export const DEFAULT_ENV_FILES = ['.env.ephm', '.env.ephemeral'] as const

export function readEnvFile(cwd: string, envFile?: string): LoadedEnvFile {
  if (!envFile) {
    for (const candidate of DEFAULT_ENV_FILES) {
      const candidatePath = resolve(cwd, candidate)
      if (existsSync(candidatePath)) {
        return {
          path: candidatePath,
          exists: true,
          values: parse(readFileSync(candidatePath))
        }
      }
    }

    return {
      path: resolve(cwd, DEFAULT_ENV_FILES[0]),
      exists: false,
      values: {}
    }
  }

  const envPath = resolve(cwd, envFile)

  if (!existsSync(envPath)) {
    return {
      path: envPath,
      exists: false,
      values: {}
    }
  }

  return {
    path: envPath,
    exists: true,
    values: parse(readFileSync(envPath))
  }
}

export function cleanProcessEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const output: Record<string, string> = {}

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      output[key] = value
    }
  }

  return output
}

export function mergeRuntimeEnv(options: {
  envFile: Record<string, string>
  generated: Record<string, string>
  processEnv?: Record<string, string>
}): Record<string, string> {
  return {
    ...options.envFile,
    ...options.generated,
    ...(options.processEnv ?? cleanProcessEnv())
  }
}
