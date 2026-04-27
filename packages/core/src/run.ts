import { basename } from 'node:path'
import { loadConfig } from './config.js'
import { cleanProcessEnv, mergeRuntimeEnv, readEnvFile } from './env.js'
import { interpolateArray, interpolateRecord } from './interpolate.js'
import { createCleanup } from './lifecycle.js'
import { createLogger, logCleanup, logStartupSummary, quoteCommand, type Logger } from './logger.js'
import { createPortResolver } from './ports.js'
import { spawnCommand } from './runCommand.js'
import { spawnApp } from './spawnApp.js'
import type { CommandConfig, ResolvedPort, ServiceContext, ServiceStartResult } from './service.js'

export type RunOptions = {
  cwd?: string
  configPath?: string
  logger?: Logger
}

export async function run(options: RunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const logger = options.logger ?? createLogger()
  const loaded = await loadConfig({ cwd, configPath: options.configPath })
  const config = loaded.config
  const namespace = config.namespace ?? basename(cwd)
  const processEnv = cleanProcessEnv()
  const envFile = readEnvFile(cwd, config.envFile)
  const shouldLogEnvFile = Boolean(config.envFile) || envFile.exists
  const baseEnv = {
    ...envFile.values,
    ...processEnv
  }
  const environmentKey = baseEnv.EPHEMERAL_ENV_ID || cwd
  const environmentId = `${namespace}:${environmentKey}`
  const resolvePort = createPortResolver({
    namespace,
    environmentKey,
    env: baseEnv
  })
  const selectedPorts: ResolvedPort[] = []
  const appPort = await resolvePort('app', config.app.port, {
    envVar: 'APP_PORT',
    defaultBase: 10_000,
    defaultRange: 5000
  })
  selectedPorts.push(appPort)

  const services: ServiceStartResult[] = []
  const serviceStops: Array<() => Promise<void>> = []
  const generatedServiceEnv: Record<string, string> = {}

  const serviceContext: ServiceContext = {
    cwd,
    namespace,
    environmentId,
    env: {
      ...baseEnv,
      APP_PORT: String(appPort.port)
    },
    resolvePort: async (name, portConfig, resolverOptions) => {
      const resolved = await resolvePort(name, portConfig, resolverOptions)
      selectedPorts.push(resolved)
      return resolved
    }
  }

  try {
    for (const service of config.services ?? []) {
      const started = await service.start(serviceContext)
      services.push(started)
      serviceStops.push(started.stop)
      Object.assign(generatedServiceEnv, started.env)
      Object.assign(serviceContext.env, started.env)
    }

    const generatedAppEnv = {
      APP_PORT: String(appPort.port),
      ...interpolateRecord(config.app.env, {
        ...baseEnv,
        ...generatedServiceEnv,
        APP_PORT: String(appPort.port)
      })
    }
    const appEnv = mergeRuntimeEnv({
      envFile: envFile.values,
      generated: {
        ...generatedServiceEnv,
        ...generatedAppEnv
      },
      processEnv
    })
    const appArgs = interpolateArray(config.app.args, appEnv)
    const appUrl = `http://localhost:${appPort.port}`
    const appCommand = [config.app.command, ...appArgs]
    const beforeAppCommands = interpolateCommands(config.beforeApp, appEnv)
    const warnings = serviceEnvOverrideWarnings(generatedServiceEnv, processEnv)

    logStartupSummary({
      logger,
      namespace,
      environmentId,
      configPath: loaded.path,
      envFile: shouldLogEnvFile ? { path: envFile.path, exists: envFile.exists } : undefined,
      warnings,
      ports: selectedPorts,
      services,
      beforeAppCommands,
      appCommand,
      appUrl
    })

    let activeSetupCommandStop: (() => Promise<void>) | undefined
    const cleanupSetup = createCleanup([
      async () => {
        await activeSetupCommandStop?.()
      },
      ...serviceStops
    ])
    const removeSetupSignalHandlers = installSignalHandlers(cleanupSetup, logger)

    try {
      for (const command of beforeAppCommands) {
        logger.line(`running beforeApp: ${quoteCommand(command)}`)
        const setupCommand = spawnCommand({
          command,
          cwd,
          env: appEnv
        })
        activeSetupCommandStop = setupCommand.stop

        try {
          await setupCommand.exit
        } finally {
          activeSetupCommandStop = undefined
        }
      }
    } finally {
      removeSetupSignalHandlers()
    }

    const app = spawnApp({
      command: config.app.command,
      args: appArgs,
      cwd,
      env: appEnv
    })
    const cleanup = createCleanup([app.stop, ...serviceStops])
    const removeSignalHandlers = installSignalHandlers(cleanup, logger)

    try {
      const exitCode = await app.exit
      await cleanup()
      return exitCode
    } finally {
      removeSignalHandlers()
    }
  } catch (error) {
    const cleanup = createCleanup(serviceStops)
    await cleanup()
    throw error
  }
}

function interpolateCommands(commands: CommandConfig[] | undefined, env: Record<string, string>): CommandConfig[] {
  return (commands ?? []).map((command) => interpolateArray([...command], env) as CommandConfig)
}

function serviceEnvOverrideWarnings(generatedServiceEnv: Record<string, string>, processEnv: Record<string, string>): string[] {
  return Object.entries(generatedServiceEnv)
    .filter(([key, value]) => processEnv[key] !== undefined && processEnv[key] !== value)
    .map(([key]) => `existing process env ${key} overrides generated service value`)
}

function installSignalHandlers(cleanup: () => Promise<void>, logger: Logger): () => void {
  const signals: NodeJS.Signals[] = process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP']
  const handlers = new Map<NodeJS.Signals, () => void>()

  for (const signal of signals) {
    const handler = () => {
      logCleanup(logger, `received ${signal}; cleaning up...`)
      cleanup()
        .catch((error: unknown) => {
          console.error(error)
        })
        .finally(() => {
          process.exit(signalToExitCode(signal))
        })
    }

    handlers.set(signal, handler)
    process.once(signal, handler)
  }

  return () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler)
    }
  }
}

function signalToExitCode(signal: NodeJS.Signals): number {
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
