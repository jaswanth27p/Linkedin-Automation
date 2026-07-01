import { pathToFileURL } from 'node:url'
import { appConfigSchema, type AppConfig } from './schema.ts'

export async function loadConfig(path = './linkedin-auto.config.ts'): Promise<AppConfig> {
  const mod = await import(pathToFileURL(path).href)
  const raw = mod.default ?? mod.config
  return appConfigSchema.parse(raw)
}
