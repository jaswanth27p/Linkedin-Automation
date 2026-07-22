import { createSignal, For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { DEFAULT_THEMES } from "../theme/index.ts"
import { theme, setTheme, currentThemeName } from "../theme/current.ts"
import { persistThemeName } from "../theme/persist.ts"

export const [themePickerOpen, setThemePickerOpen] = createSignal(false)
export const [themePickerIndex, setThemePickerIndex] = createSignal(0)

const themeNames = Object.keys(DEFAULT_THEMES).sort()

/** How many theme rows are visible at once. */
const VISIBLE_THEMES = 3

let initialTheme = "opencode"

/** Open the picker with the current theme pre-selected. */
export function openThemePicker(): void {
  initialTheme = currentThemeName()
  const idx = themeNames.indexOf(initialTheme)
  setThemePickerIndex(idx < 0 ? 0 : idx)
  setThemePickerOpen(true)
}

export function closeThemePicker(): void {
  // Revert to the theme that was active before the picker opened
  setTheme(initialTheme)
  setThemePickerOpen(false)
}

/** Move selection by delta, wrapping around both ends. Live-preview each selection. */
export function moveThemePicker(delta: number): void {
  const n = themeNames.length
  const newIdx = (themePickerIndex() + delta + n) % n
  setThemePickerIndex(newIdx)
  // Live preview: apply the theme immediately as you arrow through
  const name = themeNames[newIdx]
  if (name) setTheme(name)
}

/** Confirm the selected theme, persist it, and close. */
export function confirmThemePicker(): void {
  const name = themeNames[themePickerIndex()]
  if (name) {
    setTheme(name)
    persistThemeName(name)
  }
  setThemePickerOpen(false)
}

/**
 * Centered modal theme switcher. Only renders a window of VISIBLE_THEMES rows;
 * the window slides to keep the selected row on screen as you navigate.
 * Modeled on the SuggestionBox (command suggestion list) in InputBar.tsx.
 */
export function ThemePickerOverlay() {
  const currentTheme = theme

  // First index of the visible window. Slides so the selected row stays on
  // screen — when selection moves past the bottom, the window shifts down;
  // when it moves before the top, the window shifts up.
  const windowStart = createMemo(() => {
    const n = themeNames.length
    const sel = themePickerIndex()
    const maxStart = Math.max(0, n - VISIBLE_THEMES)
    // Keep selected item roughly centered in the window
    let start = sel - Math.floor(VISIBLE_THEMES / 2)
    if (start < 0) start = 0
    if (start > maxStart) start = maxStart
    return start
  })

  const visibleThemes = createMemo(() => {
    const start = windowStart()
    return themeNames
      .slice(start, start + VISIBLE_THEMES)
      .map((name, k) => ({
        name,
        globalIndex: start + k,
        selected: start + k === themePickerIndex(),
      }))
  })

  return (
    <Show when={themePickerOpen()}>
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        justifyContent="center"
        alignItems="center"
        zIndex={4001}
      >
        <box
          border
          borderColor={currentTheme().accent}
          backgroundColor={currentTheme().backgroundPanel}
          flexDirection="column"
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={currentTheme().accent} attributes={TextAttributes.BOLD}>
            Switch theme
          </text>
          <text fg={currentTheme().textMuted}> </text>
          <For each={visibleThemes()}>
            {(item) => (
              <box
                flexDirection="row"
                backgroundColor={
                  item.selected ? currentTheme().backgroundMenu : currentTheme().backgroundElement
                }
                onMouseDown={() => {
                  setTheme(item.name)
                  persistThemeName(item.name)
                  setThemePickerOpen(false)
                }}
              >
                <text fg={item.selected ? currentTheme().accent : currentTheme().textMuted}>
                  {item.selected ? "▌ " : "  "}
                </text>
                <text fg={item.selected ? currentTheme().accent : currentTheme().text}>
                  {item.name}
                </text>
              </box>
            )}
          </For>
          <text fg={currentTheme().textMuted}> </text>
          <text fg={currentTheme().textMuted}>
            ↑/↓ move · Enter select · Esc cancel · {themePickerIndex() + 1}/{themeNames.length}
          </text>
        </box>
      </box>
    </Show>
  )
}
