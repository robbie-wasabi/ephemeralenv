import type { ResolvedPort, SeedSummary, ServiceStartResult } from './service.js'

export type Logger = {
  line: (message?: string) => void
}

export function createLogger(write: (message: string) => void = console.log): Logger {
  return {
    line(message = '') {
      write(message)
    }
  }
}

export function logStartupSummary(options: {
  logger: Logger
  namespace: string
  environmentId: string
  configPath: string
  envFile?: { path: string; exists: boolean }
  ports: ResolvedPort[]
  services: ServiceStartResult[]
  appCommand: string[]
  appUrl: string
}): void {
  const { logger } = options

  logger.line('ephemeralenv')
  logger.line()
  logger.line('Environment:')
  logger.line(`  namespace: ${options.namespace}`)
  logger.line(`  id: ${options.environmentId}`)
  logger.line(`  config: ${options.configPath}`)

  if (options.envFile) {
    logger.line(`  env file: ${options.envFile.exists ? options.envFile.path : `${options.envFile.path} (not found)`}`)
  }

  logger.line()
  logger.line('Ports:')
  for (const port of options.ports) {
    const fallback = port.port === port.preferredPort ? '' : ` (preferred ${port.preferredPort} unavailable)`
    const source = port.explicit && port.envVar ? ` from ${port.envVar}` : ''
    logger.line(`  ${port.name}: ${port.port}${source}${fallback}`)
  }

  if (options.services.length > 0) {
    logger.line()
    logger.line('Services:')
    for (const service of options.services) {
      logger.line(`  ${service.name}`)
      for (const [key, value] of Object.entries(service.metadata ?? {})) {
        logger.line(`    ${key}: ${value}`)
      }
    }

    const seeded = options.services.flatMap((service) => service.seeded ?? [])
    if (seeded.length > 0) {
      logger.line()
      logger.line('Seeded:')
      for (const seed of seeded) {
        logger.line(`  ${seed.label}: ${seed.count} ${seed.unit}`)
      }
    }
  }

  logger.line()
  logger.line('App:')
  logger.line(`  command: ${quoteCommand(options.appCommand)}`)
  logger.line(`  url: ${options.appUrl}`)

  const firstServiceEnv = options.services.flatMap((service) => Object.entries(service.env))[0]
  if (firstServiceEnv) {
    logger.line()
    logger.line('Use this database from another script:')
    logger.line(`  ${firstServiceEnv[0]}="${firstServiceEnv[1]}" pnpm your-script`)
  }

  logger.line()
}

export function logCleanup(logger: Logger, message: string): void {
  logger.line(message)
}

function quoteCommand(parts: string[]): string {
  return parts.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')
}
