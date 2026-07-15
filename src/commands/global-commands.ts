import { registerCommand } from './registry.ts'
import { listCommandsForTab } from './registry.ts'
import { appState, setSessionStatus, setActiveTab, setSetting, pushLog, TAB_IDS } from '../state/app-state.ts'
import type { TabId, Settings } from '../state/types.ts'
import { getBrowserServerPort } from '../browser/session.ts'
import { verifyLogin } from '../browser/verify-login.ts'
import { openTabPicker } from '../tui/components/TabPicker.tsx'

export function registerGlobalCommands(): void {
  registerCommand({
    name: 'help',
    scope: 'global',
    description: 'List available commands for the active tab',
    run: () => {
      const list = listCommandsForTab(appState.activeTab)
      pushLog(appState.activeTab, `Commands: ${list.map((c) => '/' + c.name).join(', ')}`)
    },
  })

  registerCommand({
    name: 'tab',
    scope: 'global',
    description: '/tab [search|easy|external] — switch tab (no arg opens a picker)',
    run: (ctx) => {
      const target = ctx.args[0] as TabId | undefined
      // No argument → open the centered picker dialog.
      if (!target) {
        openTabPicker()
        return
      }
      if (!TAB_IDS.includes(target)) {
        pushLog(appState.activeTab, `Usage: /tab ${TAB_IDS.join('|')}`)
        return
      }
      setActiveTab(target)
    },
  })

  registerCommand({
    name: 'set',
    scope: 'global',
    description: '/set <concurrency|model|irrelevantBailRatio|maxJobsPerRun|minNavDelayMs|maxNavDelayMs> <value>',
    run: (ctx) => {
      const [key, ...rest] = ctx.args
      const value = rest.join(' ')
      if (key === 'concurrency') setSetting('concurrency', Number(value))
      else if (key === 'model') setSetting('model', value)
      else if (key === 'irrelevantBailRatio') setSetting('irrelevantBailRatio', Number(value))
      else if (key === 'maxJobsPerRun') setSetting('maxJobsPerRun', Number(value))
      else if (key === 'minNavDelayMs') setSetting('minNavDelayMs', Number(value))
      else if (key === 'maxNavDelayMs') setSetting('maxNavDelayMs', Number(value))
      else {
        pushLog(
          appState.activeTab,
          `Unknown setting: ${key}. Use concurrency, model, irrelevantBailRatio, maxJobsPerRun, minNavDelayMs, or maxNavDelayMs.`,
        )
        return
      }
      pushLog(appState.activeTab, `Set ${key} = ${value}`)
    },
  })

  registerCommand({
    name: 'verify-login',
    scope: 'global',
    description: 'Check LinkedIn login status in the bootstrap browser',
    run: async () => {
      const port = getBrowserServerPort()
      const result = await verifyLogin(port)
      setSessionStatus('linkedin', result.linkedin)
      if (result.linkedin) {
        pushLog(appState.activeTab, 'Login verified: LinkedIn connected.')
      } else {
        pushLog(appState.activeTab, 'Not logged in yet. Log in in the browser window, then run /verify-login again.')
      }
    },
  })

  registerCommand({
    name: 'exit',
    scope: 'global',
    description: 'Close the browser and exit the application',
    run: async () => {
      pushLog(appState.activeTab, 'Shutting down...')
      // Only destroy the TUI here — main()'s cleanup() (awaiting mountTui())
      // then stops the search agent, both queue workers, and the browser in
      // the correct order. Shutting the browser down here directly used to
      // race with cleanup() doing the same thing out of order.
      const { destroyTui } = await import('../tui/index.tsx')
      destroyTui()
    },
  })
}
