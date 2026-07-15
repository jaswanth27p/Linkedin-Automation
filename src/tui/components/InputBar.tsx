import { createSignal, Show, For, onCleanup, createMemo } from 'solid-js'
import { theme } from '../theme.ts'
import { listCommandsForTab } from '../../commands/registry.ts'
import { dispatchCommand } from '../../commands/dispatch.ts'
import { appState } from '../../state/app-state.ts'
import { answerPrompt } from '../../state/prompt-channel.ts'
import type { Command } from '../../commands/types.ts'

export let [suggestions, setSuggestions] = createSignal<Command[]>([])
export let [selectedSuggestionIndex, setSelectedSuggestionIndex] = createSignal(-1)

export function dismissSuggestions() {
  setSuggestions([])
  setSelectedSuggestionIndex(-1)
}

function filterCommands(raw: string): Command[] {
  if (!raw.startsWith('/')) return []
  const query = raw.slice(1).toLowerCase()
  const cmds = listCommandsForTab(appState.activeTab)
  if (!query) return cmds
  return cmds.filter(c => c.name.startsWith(query))
}

// How many suggestion rows are visible at once. The full list is always
// navigable — the window slides to keep the selected row in view rather than
// truncating with a "+N more" note.
const VISIBLE_SUGGESTIONS = 5

export function SuggestionBox() {
  // First index of the visible window. Slides so the selected row stays on
  // screen: when selection moves past the bottom, the window shifts down (the
  // selected row sits on the last visible line); it never scrolls past the ends.
  const windowStart = createMemo(() => {
    const n = suggestions().length
    const sel = selectedSuggestionIndex()
    const eff = sel < 0 ? 0 : sel
    const maxStart = Math.max(0, n - VISIBLE_SUGGESTIONS)
    let start = eff - VISIBLE_SUGGESTIONS + 1
    if (start < 0) start = 0
    if (start > maxStart) start = maxStart
    return start
  })

  const rows = createMemo(() => {
    const start = windowStart()
    return suggestions()
      .slice(start, start + VISIBLE_SUGGESTIONS)
      .map((cmd, k) => {
        const i = start + k
        return { cmd, i, selected: i === selectedSuggestionIndex() }
      })
  })

  const hasAbove = createMemo(() => windowStart() > 0)
  const hasBelow = createMemo(() => windowStart() + VISIBLE_SUGGESTIONS < suggestions().length)

  return (
    <Show when={suggestions().length > 0}>
      <box
        border
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
        maxHeight={VISIBLE_SUGGESTIONS + 2}
      >
        <For each={rows()}>
          {(row) => (
            <box
              flexDirection="row"
              onMouseDown={() => {
                dispatchCommand('/' + row.cmd.name)
                dismissSuggestions()
              }}
            >
              <text fg={row.selected ? theme.accent : theme.textMuted}>
                {row.selected ? '▌' : hasAbove() && row.i === windowStart() ? '↑' : hasBelow() && row.i === windowStart() + VISIBLE_SUGGESTIONS - 1 ? '↓' : ' '}
              </text>
              <text fg={row.selected ? theme.accent : theme.textMuted}>
                /{row.cmd.name}
              </text>
              <text fg={theme.textMuted}> — {row.cmd.description}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

export function InputBar(props: { onSubmit: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = createSignal('')
  const pendingQuestion = createMemo(() => appState.tabs[appState.activeTab].needsInputQuestion)

  const handleInput = (v: string) => {
    setValue(v)
    if (pendingQuestion()) {
      setSuggestions([])
      return
    }
    const matches = filterCommands(v)
    setSuggestions(matches)
    setSelectedSuggestionIndex(-1)
  }

  onCleanup(() => dismissSuggestions())

  return (
    <box border borderColor={theme.border} height={3} paddingLeft={1} paddingRight={1}>
      <input
        value={value()}
        placeholder={
          pendingQuestion()
            ? `? ${pendingQuestion()}`
            : props.disabled
              ? 'Waiting for browser login...'
              : 'Type / for commands'
        }
        onInput={handleInput}
        onSubmit={() => {
          const v = value().trim()
          if (!v) return
          const question = pendingQuestion()
          if (question) {
            answerPrompt(appState.activeTab, v)
          } else {
            props.onSubmit(v)
          }
          setValue('')
          dismissSuggestions()
        }}
      />
    </box>
  )
}
