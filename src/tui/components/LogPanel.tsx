import { For } from 'solid-js'
import { appState } from '../../state/app-state.ts'
import { theme } from '../theme.ts'
import type { TabId } from '../../state/types.ts'

export function LogPanel(props: { tab: TabId }) {
  return (
    <scrollbox
      border
      borderColor={theme.border}
      flexGrow={1}
      minHeight={0}
      padding={1}
      scrollY
      stickyScroll
      stickyStart="bottom"
      viewportCulling={false}
      contentOptions={{ flexDirection: 'column' }}
    >
      <For each={appState.tabs[props.tab].logs}>{(line) => <text fg={theme.text}>{line}</text>}</For>
    </scrollbox>
  )
}
