import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import type { PortConfig, ResolvedPort } from './service.js'

const MIN_PORT = 1
const MAX_PORT = 65_535

export class PortUnavailableError extends Error {
  constructor(port: number, envVar?: string) {
    const source = envVar ? ` from ${envVar}` : ''
    super(`Port ${port}${source} is unavailable`)
    this.name = 'PortUnavailableError'
  }
}

export function stableHash(input: string): number {
  const digest = createHash('sha256').update(input).digest()
  return digest.readUInt32BE(0)
}

export function preferredPort(seed: string, config: PortConfig): number {
  const range = config.range ?? 5000
  assertPortConfig(config)
  return config.base + (stableHash(seed) % range)
}

export async function isPortAvailable(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    return false
  }

  return (await canListen(port, '127.0.0.1')) && (await canListen(port))
}

export async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }

        reject(new Error('Unable to allocate a free port'))
      })
    })
  })
}

export function parseExplicitPort(value: string | undefined, envVar: string): number | undefined {
  if (!value) {
    return undefined
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`${envVar} must be an integer between ${MIN_PORT} and ${MAX_PORT}`)
  }

  return port
}

export function createPortResolver(options: {
  namespace: string
  environmentKey: string
  env: Record<string, string>
}) {
  const selected = new Set<number>()

  return async function resolvePort(
    name: string,
    config: PortConfig,
    resolverOptions: { envVar?: string; defaultBase?: number; defaultRange?: number } = {}
  ): Promise<ResolvedPort> {
    const normalized = normalizePortConfig(config, resolverOptions.defaultBase, resolverOptions.defaultRange)
    const explicitPort = resolverOptions.envVar ? parseExplicitPort(options.env[resolverOptions.envVar], resolverOptions.envVar) : undefined
    const preferred = explicitPort ?? preferredPort(`${options.namespace}:${options.environmentKey}:${name}`, normalized)

    if (explicitPort !== undefined) {
      if (selected.has(explicitPort) || !(await isPortAvailable(explicitPort))) {
        throw new PortUnavailableError(explicitPort, resolverOptions.envVar)
      }

      selected.add(explicitPort)
      return {
        name,
        port: explicitPort,
        preferredPort: explicitPort,
        explicit: true,
        envVar: resolverOptions.envVar
      }
    }

    if (!selected.has(preferred) && (await isPortAvailable(preferred))) {
      selected.add(preferred)
      return {
        name,
        port: preferred,
        preferredPort: preferred,
        explicit: false,
        envVar: resolverOptions.envVar
      }
    }

    const fallback = await getFreePort()
    selected.add(fallback)

    return {
      name,
      port: fallback,
      preferredPort: preferred,
      explicit: false,
      envVar: resolverOptions.envVar
    }
  }
}

function normalizePortConfig(config: PortConfig, defaultBase?: number, defaultRange?: number): PortConfig {
  const normalized = {
    base: config.base ?? defaultBase,
    range: config.range ?? defaultRange ?? 5000
  }

  assertPortConfig(normalized)
  return normalized
}

function assertPortConfig(config: PortConfig): void {
  const range = config.range ?? 5000

  if (!Number.isInteger(config.base) || config.base < MIN_PORT || config.base > MAX_PORT) {
    throw new Error(`Port base must be an integer between ${MIN_PORT} and ${MAX_PORT}`)
  }

  if (!Number.isInteger(range) || range < 1) {
    throw new Error('Port range must be a positive integer')
  }

  if (config.base + range - 1 > MAX_PORT) {
    throw new Error(`Port range ${config.base}-${config.base + range - 1} exceeds ${MAX_PORT}`)
  }
}

async function canListen(port: number, host?: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}
