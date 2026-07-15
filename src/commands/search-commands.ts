import { registerCommand } from './registry.ts'
import { pushLog } from '../state/app-state.ts'
import { getCurrentConfig } from '../config/current.ts'
import {
  runSearchUrls,
  generateSearchUrlsFromText,
  generateSearchUrlsFromResume,
  stopSearch,
  isSearchRunning,
} from '../agents/search-agent.ts'

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
      await runSearchUrls(config, config.mustCheckUrls)
    },
  })

  registerCommand({
    name: 'search-describe',
    scope: 'search',
    description: '/search-describe [free text] — describe the jobs you want (defaults to config requirements)',
    run: async (ctx) => {
      if (!guardNotRunning()) return
      const config = getCurrentConfig()
      // Text is optional: fall back to the requirements in linkedin-auto.config.ts.
      const describeText = ctx.rawArgs.trim() || config.requirements.trim()
      if (!describeText) {
        pushLog(SEARCH_TAB, 'No description given and no requirements set in linkedin-auto.config.ts.')
        return
      }
      pushLog(
        SEARCH_TAB,
        ctx.rawArgs.trim()
          ? 'Generating search URLs from your description...'
          : 'No text given — generating search URLs from config requirements...',
      )
      const urls = await generateSearchUrlsFromText(describeText)
      if (urls.length === 0) {
        pushLog(SEARCH_TAB, 'Could not generate any search URLs from that description.')
        return
      }
      pushLog(SEARCH_TAB, `Generated ${urls.length} URL(s): ${urls.join(', ')}`)
      await runSearchUrls(config, urls)
    },
  })

  registerCommand({
    name: 'search-resume',
    scope: 'search',
    description: 'Infer search filters from resume.md and run them',
    run: async () => {
      if (!guardNotRunning()) return
      const config = getCurrentConfig()
      pushLog(SEARCH_TAB, 'Generating search URLs from resume.md...')
      const urls = await generateSearchUrlsFromResume(config)
      if (urls.length === 0) {
        pushLog(SEARCH_TAB, 'Could not generate any search URLs from resume.md.')
        return
      }
      pushLog(SEARCH_TAB, `Generated ${urls.length} URL(s): ${urls.join(', ')}`)
      await runSearchUrls(config, urls)
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
}
