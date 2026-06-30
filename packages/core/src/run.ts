import { basename } from 'node:path'
import { loadConfig } from './config.js'
import { cleanProcessEnv, mergeRuntimeEnv, readEnvFile } from './env.js'
import { interpolateArray, interpolateRecord } from './interpolate.js'
import { createCleanup } from './lifecycle.js'
import { createLogger, logCleanup, logStartupSummary, quoteCommand, type Logger } from './logger.js'
import { createPortResolver } from './ports.js'
import { spawnCommand, type SpawnedCommand } from './runCommand.js'
import { acquireEnvironmentSlot } from './slots.js'
import { spawnApp } from './spawnApp.js'
import type { CommandConfig, ResolvedPort, ServiceContext, ServiceStartResult } from './service.js'

export type RunOptions = {
  cwd?: string
  configPath?: string
  logger?: Logger
  /**
   * Aborting this signal triggers a graceful shutdown in backend-only mode
   * (no `app` configured), mirroring an interrupt. Useful for embedding `run`
   * in a longer-lived process or test.
   */
  signal?: AbortSignal
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
  const slot = await acquireEnvironmentSlot({ env: baseEnv, environmentId })
  const resolvePort = createPortResolver({
    namespace,
    environmentKey,
    env: baseEnv
  })
  const selectedPorts: ResolvedPort[] = []
  const services: ServiceStartResult[] = []
  const serviceStops: Array<() => Promise<void>> = []
  const generatedServiceEnv: Record<string, string> = {}

  try {
    let appPort: ResolvedPort | undefined
    if (config.app) {
      appPort = await resolvePort('app', config.app.port, {
        envVar: 'APP_PORT',
        defaultBase: 10_000,
        defaultRange: 5000
      })
      selectedPorts.push(appPort)
    }

    const appPortEnv: Record<string, string> = appPort ? { APP_PORT: String(appPort.port) } : {}

    const serviceContext: ServiceContext = {
      cwd,
      namespace,
      environmentId,
      env: {
        ...baseEnv,
        ...appPortEnv
      },
      resolvePort: async (name, portConfig, resolverOptions) => {
        const resolved = await resolvePort(name, portConfig, resolverOptions)
        selectedPorts.push(resolved)
        return resolved
      }
    }

    for (const service of config.services ?? []) {
      const started = await service.start(serviceContext)
      services.push(started)
      serviceStops.push(started.stop)
      Object.assign(generatedServiceEnv, started.env)
      Object.assign(serviceContext.env, started.env)
    }

    const generatedAppEnv = {
      ...appPortEnv,
      ...interpolateRecord(config.app?.env, {
        ...baseEnv,
        ...generatedServiceEnv,
        ...appPortEnv
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
    const appArgs = interpolateArray(config.app?.args, appEnv)
    const appUrl = appPort ? `http://localhost:${appPort.port}` : undefined
    const appCommand = config.app ? [config.app.command, ...appArgs] : undefined
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

    let activeSetupCommand: SpawnedCommand | undefined
    const cleanupSetup = createCleanup([
      slot.release,
      ...serviceStops,
      async () => {
        await activeSetupCommand?.stop()
      }
    ])
    const removeSetupSignalHandlers = installSignalHandlers(cleanupSetup, logger, () => {
      activeSetupCommand?.forceKill()
    })

    try {
      for (const command of beforeAppCommands) {
        logger.line(`running beforeApp: ${quoteCommand(command)}`)
        const setupCommand = spawnCommand({
          command,
          cwd,
          env: appEnv
        })
        activeSetupCommand = setupCommand

        try {
          await setupCommand.exit
        } finally {
          activeSetupCommand = undefined
        }
      }
    } finally {
      removeSetupSignalHandlers()
    }

    if (!config.app) {
      const cleanup = createCleanup([slot.release, ...serviceStops])
      logger.line('services ready; holding open until interrupted (Ctrl-C to stop)')
      return await holdUntilInterrupted({ cleanup, logger, signal: options.signal })
    }

    const app = spawnApp({
      command: config.app.command,
      args: appArgs,
      cwd,
      env: appEnv
    })
    const cleanup = createCleanup([slot.release, ...serviceStops, app.stop])
    const removeSignalHandlers = installSignalHandlers(cleanup, logger, app.forceKill)

    try {
      const exitCode = await app.exit
      await cleanup()
      return exitCode
    } finally {
      removeSignalHandlers()
    }
  } catch (error) {
    const cleanup = createCleanup([slot.release, ...serviceStops])
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

function holdUntilInterrupted(options: {
  cleanup: () => Promise<void>
  logger: Logger
  signal?: AbortSignal
}): Promise<number> {
  const { cleanup, logger, signal } = options
  const signals: NodeJS.Signals[] = process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP']

  return new Promise<number>((resolve) => {
    const handlers = new Map<NodeJS.Signals, () => void>()
    let shuttingDown = false

    const teardown = () => {
      for (const [sig, handler] of handlers) {
        process.off(sig, handler)
      }
      signal?.removeEventListener('abort', onAbort)
    }

    const shutdown = (exitCode: number, reason: string) => {
      if (shuttingDown) {
        return
      }

      shuttingDown = true
      teardown()
      logCleanup(logger, `${reason}; cleaning up...`)
      cleanup()
        .catch((error: unknown) => {
          console.error(error)
        })
        .finally(() => {
          resolve(exitCode)
        })
    }

    function onAbort() {
      shutdown(0, 'shutdown requested')
    }

    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }

      signal.addEventListener('abort', onAbort, { once: true })
    }

    for (const sig of signals) {
      const handler = () => {
        if (shuttingDown) {
          logCleanup(logger, `received ${sig} again; forcing exit`)
          process.exit(signalToExitCode(sig))
        }

        shutdown(signalToExitCode(sig), `received ${sig}`)
      }

      handlers.set(sig, handler)
      process.on(sig, handler)
    }
  })
}

function installSignalHandlers(cleanup: () => Promise<void>, logger: Logger, forceKill?: () => void): () => void {
  const signals: NodeJS.Signals[] = process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP']
  const handlers = new Map<NodeJS.Signals, () => void>()
  let cleaningUp = false

  for (const signal of signals) {
    const handler = () => {
      if (cleaningUp) {
        logCleanup(logger, `received ${signal} again; forcing exit`)
        forceKill?.()
        process.exit(signalToExitCode(signal))
      }

      cleaningUp = true
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
    process.on(signal, handler)
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
