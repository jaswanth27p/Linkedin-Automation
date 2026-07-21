import { registerCommand } from './registry.ts'
import { pushLog } from '../state/app-state.ts'
import { getCurrentConfig } from '../config/current.ts'
import { runSearchUrls, stopSearch, isSearchRunning } from '../agents/search-agent.ts'
import { startAutoMode, stopAutoMode, parseDurationMs } from '../agents/search-scheduler.ts'

const SEARCH_TAB = 'search'

function guardNotRunning(): boolean {
  if (isSearchRunning()) {
    pushLog(SEARCH_TAB, 'A search is already running. Use /stop-search first.')
    return false
  }
  return true
}

export function registerSearchCommands(): void {
  registerCommand({
    name: 'search-urls',
    scope: 'search',
    description: 'Run configured LinkedIn search URLs',
    run: async () => {
      if (!guardNotRunning()) return
      const config = getCurrentConfig()
      await runSearchUrls(config.mustCheckUrls)
    },
  })

  registerCommand({
    name: 'stop-search',
    scope: 'search',
    description: 'Stop the in-progress search run',
    run: () => {
      if (!isSearchRunning()) {
        pushLog(SEARCH_TAB, 'No search is running.')
        return
      }
      stopSearch()
      pushLog(SEARCH_TAB, 'Stopping search...')
    },
  })

  registerCommand({
    name: 'auto-on',
    scope: 'search',
    description:
      '/auto-on loop | /auto-on interval <duration> (e.g. 1h, 3h, 90m) — repeatedly run the configured search URLs, and start the easy-apply queue worker',
    run: (ctx) => {
      const mode = ctx.args[0]
      if (mode === 'loop') {
        startAutoMode('loop')
        return
      }
      if (mode === 'interval') {
        const durationRaw = ctx.args[1]
        if (!durationRaw) {
          pushLog(SEARCH_TAB, 'Usage: /auto-on interval <duration> (e.g. 1h, 3h, 90m)')
          return
        }
        const ms = parseDurationMs(durationRaw)
        if (ms === null) {
          pushLog(SEARCH_TAB, `Invalid duration: ${durationRaw}. Use formats like 1h, 3h, 90m, 3h30m.`)
          return
        }
        startAutoMode('interval', ms)
        return
      }
      pushLog(SEARCH_TAB, 'Usage: /auto-on loop | /auto-on interval <duration>')
    },
  })

  registerCommand({
    name: 'auto-off',
    scope: 'search',
    description: 'Stop the auto-mode search rotation (the easy-apply queue worker keeps running)',
    run: () => stopAutoMode(),
  })
}
