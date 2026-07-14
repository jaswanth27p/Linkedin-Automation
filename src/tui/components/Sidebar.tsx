import { For, Show } from 'solid-js'
import { TextAttributes } from '@opentui/core'
import { appState, TAB_IDS } from '../../state/app-state.ts'
import { theme } from '../theme.ts'
import type { TabId } from '../../state/types.ts'

const TAB_LABELS: Record<TabId, string> = {
  search: 'Search',
  easy: 'Easy Apply',
  external: 'External Apply',
}

export function Sidebar() {
  return (
    <scrollbox border borderColor={theme.border} width="100%" flexDirection="column" padding={1} scrollY>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>Session</text>
      <text fg={appState.session.linkedin ? theme.success : theme.textMuted}>
        LinkedIn: {appState.session.linkedin ? 'connected' : 'waiting'}
      </text>

      <text fg={theme.text}> </text>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>Agents</text>
      <For each={TAB_IDS}>
        {(tab) => (
          <box flexDirection="column">
            <text
              fg={appState.tabs[tab].status === 'needs_input' ? theme.warning : theme.text}
              bg={appState.activeTab === tab ? theme.backgroundPanel : undefined}
            >
              {TAB_LABELS[tab]}: {appState.tabs[tab].status}
              {appState.tabs[tab].status === 'needs_input' ? ' ⚠' : ''}
            </text>
            <Show when={appState.tabs[tab].step}>
              <text fg={theme.textMuted}>  {appState.tabs[tab].step}</text>
            </Show>
            <Show when={appState.tabs[tab].needsInputQuestion}>
              <text fg={theme.warning}>  ? {appState.tabs[tab].needsInputQuestion}</text>
            </Show>
          </box>
        )}
      </For>
    </scrollbox>
  )
}
