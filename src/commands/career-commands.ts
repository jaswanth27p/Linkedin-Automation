import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { registerCommand } from './registry.ts'
import { pushLog } from '../state/app-state.ts'
import { getDb } from '../db/index.ts'
import { careerPages } from '../db/schema.ts'
import { runCareerCheck, stopCareerCheck, isCareerCheckRunning } from '../agents/career-scan-agent.ts'

const CAREERS_TAB = 'careers'

/** Derives a display label from a URL's hostname (e.g. "https://stripe.com/jobs" -> "stripe.com")
 * for /add-career-url calls that don't supply one. Exported for unit testing. */
export function deriveLabelFromUrl(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '')
}

/** Parses/validates a career-page URL. Returns null (not a throw) on invalid input so callers can
 * log a friendly usage message instead of surfacing a raw URL-parse error. Exported for unit testing. */
export function parseCareerUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

export function registerCareerCommands(): void {
  registerCommand({
    name: 'add-career-url',
    scope: 'careers',
    description: '/add-career-url <url> [label] — track an external career page for /check-careers',
    run: async (ctx) => {
      const [rawUrl, ...labelParts] = ctx.args
      if (!rawUrl) {
        pushLog(CAREERS_TAB, 'Usage: /add-career-url <url> [label]')
        return
      }

      const parsed = parseCareerUrl(rawUrl)
      if (!parsed) {
        pushLog(CAREERS_TAB, `Not a valid http(s) URL: ${rawUrl}`)
        return
      }

      const url = parsed.toString()
      const label = labelParts.join(' ').trim() || deriveLabelFromUrl(url)

      const db = getDb()
      const existing = await db.select({ id: careerPages.id }).from(careerPages).where(eq(careerPages.url, url))
      if (existing.length > 0) {
        pushLog(CAREERS_TAB, `Already tracking ${url}`)
        return
      }

      await db.insert(careerPages).values({ id: randomUUID(), url, label })
      pushLog(CAREERS_TAB, `Tracking career page: ${label} (${url})`)
    },
  })

  registerCommand({
    name: 'check-careers',
    scope: 'careers',
    description: 'Re-scan every tracked career page for new relevant postings',
    run: async () => {
      if (isCareerCheckRunning()) {
        pushLog(CAREERS_TAB, 'A career-page check is already running. Use /stop-careers first.')
        return
      }
      await runCareerCheck()
    },
  })

  registerCommand({
    name: 'stop-careers',
    scope: 'careers',
    description: 'Stop the in-progress career-page check',
    run: () => {
      if (!isCareerCheckRunning()) {
        pushLog(CAREERS_TAB, 'No career-page check is running.')
        return
      }
      stopCareerCheck()
      pushLog(CAREERS_TAB, 'Stopping career-page check...')
    },
  })
}
