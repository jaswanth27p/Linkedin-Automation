import { registerCommand } from './registry.ts'
import { listCommandsForTab } from './registry.ts'
import { appState, setSessionStatus, setActiveTab, setSetting, pushLog, TAB_IDS } from '../state/app-state.ts'
import type { TabId, Settings } from '../state/types.ts'
import { getBrowserManager } from '../browser/session.ts'
import { verifyLogin } from '../browser/verify-login.ts'

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
    description: '/tab search|easy|external — switch active tab',
    run: (ctx) => {
      const target = ctx.args[0] as TabId | undefined
      if (!target || !TAB_IDS.includes(target)) {
        pushLog(appState.activeTab, `Usage: /tab ${TAB_IDS.join('|')}`)
        return
      }
      setActiveTab(target)
    },
  })

  registerCommand({
    name: 'set',
    scope: 'global',
    description: '/set <concurrency|model|irrelevantBailRatio> <value>',
    run: (ctx) => {
      const [key, ...rest] = ctx.args
      const value = rest.join(' ')
      if (key === 'concurrency') setSetting('concurrency', Number(value))
      else if (key === 'model') setSetting('model', value)
      else if (key === 'irrelevantBailRatio') setSetting('irrelevantBailRatio', Number(value))
      else {
        pushLog(appState.activeTab, `Unknown setting: ${key}. Use concurrency, model, or irrelevantBailRatio.`)
        return
      }
      pushLog(appState.activeTab, `Set ${key} = ${value}`)
    },
  })

  registerCommand({
    name: 'verify-login',
    scope: 'global',
    description: 'Check LinkedIn + Gmail login status in the bootstrap browser',
    run: async () => {
      const manager = getBrowserManager()
      const result = await verifyLogin(manager)
      setSessionStatus('linkedin', result.linkedin)
      setSessionStatus('gmail', result.gmail)
      if (result.linkedin && result.gmail) {
        pushLog(appState.activeTab, 'Login verified: LinkedIn + Gmail connected.')
      } else {
        const missing = [!result.linkedin && 'LinkedIn', !result.gmail && 'Gmail'].filter(Boolean).join(', ')
        pushLog(appState.activeTab, `Not logged in yet: ${missing}. Log in in the browser window, then run /verify-login again.`)
      }
    },
  })
}
