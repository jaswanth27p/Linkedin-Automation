import { createSignal, Show, For, onCleanup, createMemo } from 'solid-js'
import { theme } from '../theme.ts'
import { listCommandsForTab } from '../../commands/registry.ts'
import { dispatchCommand } from '../../commands/dispatch.ts'
import { appState } from '../../state/app-state.ts'
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

const MAX_SUGGESTIONS = 8

export function SuggestionBox() {
  const rows = createMemo(() =>
    suggestions().slice(0, MAX_SUGGESTIONS).map((cmd, i) => ({
      cmd,
      i,
      selected: i === selectedSuggestionIndex(),
    }))
  )

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
        maxHeight={MAX_SUGGESTIONS + 2}
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
                {row.selected ? '▌' : ' '}
              </text>
              <text fg={row.selected ? theme.accent : theme.textMuted}>
                /{row.cmd.name}
              </text>
              <text fg={theme.textMuted}> — {row.cmd.description}</text>
            </box>
          )}
        </For>
        <Show when={suggestions().length > MAX_SUGGESTIONS}>
          <text fg={theme.textMuted}>
            ...and {suggestions().length - MAX_SUGGESTIONS} more
          </text>
        </Show>
      </box>
    </Show>
  )
}

export function InputBar(props: { onSubmit: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = createSignal('')

  const handleInput = (v: string) => {
    setValue(v)
    const matches = filterCommands(v)
    setSuggestions(matches)
    setSelectedSuggestionIndex(-1)
  }

  onCleanup(() => dismissSuggestions())

  return (
    <box border borderColor={theme.border} height={3} paddingLeft={1} paddingRight={1}>
      <input
        value={value()}
        placeholder={props.disabled ? 'Waiting for browser login...' : 'Type / for commands'}
        onInput={handleInput}
        onSubmit={() => {
          const v = value().trim()
          if (!v) return
          props.onSubmit(v)
          setValue('')
          dismissSuggestions()
        }}
      />
    </box>
  )
}
