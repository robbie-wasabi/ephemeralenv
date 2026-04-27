export type PortConfig = {
  base: number
  range?: number
}

export type AppConfig = {
  command: string
  args?: string[]
  port: PortConfig
  env?: Record<string, string>
}

export type EphemeralConfig = {
  envFile?: string
  namespace?: string
  app: AppConfig
  services?: EphemeralService[]
}

export type ResolvedPort = {
  name: string
  port: number
  preferredPort: number
  explicit: boolean
  envVar?: string
}

export type SeedSummary = {
  label: string
  count: number
  unit: string
}

export type ServiceStartResult = {
  name: string
  env: Record<string, string>
  metadata?: Record<string, string | number | boolean>
  seeded?: SeedSummary[]
  stop: () => Promise<void>
}

export type ServiceContext = {
  cwd: string
  namespace: string
  environmentId: string
  env: Record<string, string>
  resolvePort: (
    name: string,
    config: PortConfig,
    options?: { envVar?: string; defaultBase?: number; defaultRange?: number }
  ) => Promise<ResolvedPort>
}

export type EphemeralService = {
  name: string
  port?: PortConfig
  start: (ctx: ServiceContext) => Promise<ServiceStartResult>
}
