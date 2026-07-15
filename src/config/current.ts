import type { AppConfig } from './schema.ts'

let current: AppConfig | null = null

export function setCurrentConfig(config: AppConfig): void {
  current = config
}

export function getCurrentConfig(): AppConfig {
  if (!current) throw new Error('Config not loaded yet')
  return current
}
