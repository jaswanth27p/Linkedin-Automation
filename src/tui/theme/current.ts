import { createSignal, createMemo } from "solid-js"
import { resolveTheme, DEFAULT_THEMES, type Theme } from "./index.ts"
import { loadPersistedThemeName } from "./persist.ts"

const [themeName, setThemeName] = createSignal<string>(
  loadPersistedThemeName() ?? "opencode",
)

export const theme = createMemo<Theme>(() =>
  resolveTheme(
    DEFAULT_THEMES[themeName()] ?? DEFAULT_THEMES.opencode!,
    "dark",
  ),
)

export function setTheme(name: string): void {
  setThemeName(name)
}

export function currentThemeName(): string {
  return themeName()
}
