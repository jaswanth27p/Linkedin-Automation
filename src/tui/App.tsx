import { createMemo } from 'solid-js'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { appState, setActiveTab, TAB_IDS } from '../state/app-state.ts'
import { dispatchCommand } from '../commands/dispatch.ts'
import { Header } from './components/Header.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { LogPanel } from './components/LogPanel.tsx'
import { InputBar, SuggestionBox, suggestions, selectedSuggestionIndex, setSelectedSuggestionIndex, dismissSuggestions } from './components/InputBar.tsx'
import { destroyTui } from './index.tsx'
import { theme } from './theme.ts'

const NARROW_WIDTH_THRESHOLD = 70

export function App() {
  const dimensions = useTerminalDimensions()
  const isNarrow = createMemo(() => dimensions().width < NARROW_WIDTH_THRESHOLD)

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      dispatchCommand('/exit')
      return
    }

    const sugs = suggestions()
    if (sugs.length > 0) {
      if (key.name === 'up') {
        key.preventDefault()
        const idx = selectedSuggestionIndex()
        setSelectedSuggestionIndex(idx < 0 ? sugs.length - 1 : idx > 0 ? idx - 1 : sugs.length - 1)
        return
      }
      if (key.name === 'down') {
        key.preventDefault()
        const idx = selectedSuggestionIndex()
        setSelectedSuggestionIndex(idx < 0 ? 0 : idx < sugs.length - 1 ? idx + 1 : 0)
        return
      }
      if (key.name === 'escape') {
        key.preventDefault()
        dismissSuggestions()
        return
      }
      if (key.name === 'tab') {
        key.preventDefault()
        const idx = selectedSuggestionIndex()
        const cmd = sugs[idx >= 0 ? idx : 0]
        if (cmd) {
          dispatchCommand('/' + cmd.name)
          dismissSuggestions()
        }
        return
      }
      if (key.name === 'return' || key.name === 'enter' || key.name === 'kpenter') {
        const idx = selectedSuggestionIndex()
        if (idx >= 0) {
          key.preventDefault()
          const cmd = sugs[idx]
          if (cmd) {
            dispatchCommand('/' + cmd.name)
            dismissSuggestions()
          }
        }
        return
      }
    }

    if (key.name === 'tab') {
      const currentIndex = TAB_IDS.indexOf(appState.activeTab)
      const nextIndex = key.shift
        ? (currentIndex - 1 + TAB_IDS.length) % TAB_IDS.length
        : (currentIndex + 1) % TAB_IDS.length
      setActiveTab(TAB_IDS[nextIndex]!)
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.background} position="relative">
      <Header />
      <box flexDirection="row" flexGrow={1}>
        <box width={isNarrow() ? 12 : 30}>
          <Sidebar />
        </box>
        <box flexDirection="column" flexGrow={1}>
          <LogPanel tab={appState.activeTab} />
        </box>
      </box>
      <box position="absolute" bottom={3} left={0} width="100%" zIndex={100}>
        <SuggestionBox />
      </box>
      <InputBar disabled={!appState.session.linkedin} onSubmit={dispatchCommand} />
    </box>
  )
}
