import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'
import type { EphemeralConfig } from './service.js'

export const DEFAULT_CONFIG_FILES = [
  'ephemeralenv.config.ts',
  'ephemeralenv.config.mts',
  'ephemeralenv.config.js',
  'ephemeralenv.config.mjs'
] as const

export async function loadConfig(options: { cwd: string; configPath?: string }): Promise<{ path: string; config: EphemeralConfig }> {
  const configPath = findConfigPath(options.cwd, options.configPath)
  const jiti = createJiti(import.meta.url)
  const imported = await jiti.import(pathToFileURL(configPath).href, { default: true })

  if (!isConfig(imported)) {
    throw new Error(`Config file ${configPath} must export an ephemeralenv config object`)
  }

  return {
    path: configPath,
    config: imported
  }
}

export function findConfigPath(cwd: string, configPath?: string): string {
  if (configPath) {
    const resolved = isAbsolute(configPath) ? configPath : resolve(cwd, configPath)
    if (!existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`)
    }

    return resolved
  }

  for (const candidate of DEFAULT_CONFIG_FILES) {
    const resolved = resolve(cwd, candidate)
    if (existsSync(resolved)) {
      return resolved
    }
  }

  throw new Error(`No config file found. Looked for: ${DEFAULT_CONFIG_FILES.join(', ')}`)
}

function isConfig(value: unknown): value is EphemeralConfig {
  if (!value || typeof value !== 'object') {
    return false
  }

  const maybe = value as Partial<EphemeralConfig>
  return Boolean(maybe.app && typeof maybe.app.command === 'string' && maybe.app.port)
}
