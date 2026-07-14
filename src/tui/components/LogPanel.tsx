import { For } from 'solid-js'
import { appState } from '../../state/app-state.ts'
import { theme } from '../theme.ts'
import type { TabId } from '../../state/types.ts'

export function LogPanel(props: { tab: TabId }) {
  return (
    <scrollbox border borderColor={theme.border} flexDirection="column" padding={1} scrollY stickyScroll stickyStart="bottom">
      <For each={appState.tabs[props.tab].logs}>{(line) => <text fg={theme.text}>{line}</text>}</For>
    </scrollbox>
  )
}
