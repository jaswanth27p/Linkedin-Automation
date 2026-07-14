import { createMemo } from 'solid-js'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { appState, setActiveTab, TAB_IDS } from '../state/app-state.ts'
import { dispatchCommand } from '../commands/dispatch.ts'
import { Header } from './components/Header.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { LogPanel } from './components/LogPanel.tsx'
import { InputBar } from './components/InputBar.tsx'
import { theme } from './theme.ts'

const NARROW_WIDTH_THRESHOLD = 70

export function App() {
  const dimensions = useTerminalDimensions()
  const isNarrow = createMemo(() => dimensions().width < NARROW_WIDTH_THRESHOLD)

  useKeyboard((key) => {
    if (key.name === 'tab') {
      const currentIndex = TAB_IDS.indexOf(appState.activeTab)
      const nextIndex = key.shift
        ? (currentIndex - 1 + TAB_IDS.length) % TAB_IDS.length
        : (currentIndex + 1) % TAB_IDS.length
      setActiveTab(TAB_IDS[nextIndex]!)
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.background}>
      <Header />
      <box flexDirection="row" flexGrow={1}>
        <box width={isNarrow() ? 12 : 30}>
          <Sidebar />
        </box>
        <box flexDirection="column" flexGrow={1}>
          <LogPanel tab={appState.activeTab} />
        </box>
      </box>
      <InputBar disabled={!appState.session.linkedin || !appState.session.gmail} onSubmit={dispatchCommand} />
    </box>
  )
}
