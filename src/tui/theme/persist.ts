import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"

const SETTINGS_PATH = path.join(import.meta.dirname, "..", "..", "..", "data", "tui-settings.json")

interface TuiSettings {
  theme?: string
}

export function loadPersistedThemeName(): string | undefined {
  try {
    if (!existsSync(SETTINGS_PATH)) return undefined
    const raw = readFileSync(SETTINGS_PATH, "utf-8")
    const settings: TuiSettings = JSON.parse(raw)
    return settings.theme
  } catch {
    return undefined
  }
}

export function persistThemeName(name: string): void {
  try {
    const dir = path.dirname(SETTINGS_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const settings: TuiSettings = { theme: name }
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8")
  } catch {
    // Silently ignore write failures
  }
}
