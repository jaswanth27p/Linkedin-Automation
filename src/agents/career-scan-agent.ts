import { randomUUID, createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { AgentBrowser } from '@mastra/agent-browser'
import type { ToolCallChunk, ToolResultChunk } from '@mastra/core/stream'
import { getSharedCdpUrl } from '../browser/session.ts'
import { getDb } from '../db/index.ts'
import { jobs, careerPages, careerPageScans } from '../db/schema.ts'
import { loadResume, loadProfile } from '../profile/loader.ts'
import { appState, pushLog, setAgentStatus } from '../state/app-state.ts'
import { waitForAnswer } from '../state/prompt-channel.ts'
import { notify } from '../notify/notify.ts'
import { noOpBrowserContextProcessor } from './no-op-browser-context-processor.ts'
import { getCurrentConfig } from '../config/current.ts'
import { logger } from '../utils/logger.ts'
import { isDevLogs } from '../utils/dev-mode.ts'
import type { TabId } from '../state/types.ts'

const CAREERS_TAB: TabId = 'careers'

const NAVIGATION_TOOLS = new Set(['browser_goto', 'browser_click', 'browser_tabs'])

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function randomNavDelayMs(): number {
  const min = Math.max(0, appState.settings.minNavDelayMs)
  const max = Math.max(min, appState.settings.maxNavDelayMs)
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** Stable id for a career-page posting, derived from its apply URL rather than
 * supplied by the model — stays the same across rescans of the same posting,
 * which is what lets check-posting-seen recognize a posting judged in an
 * earlier /check-careers run, and can't be spoofed/mistyped. */
export function applyUrlToJobId(applyUrl: string): string {
  return createHash('sha1').update(applyUrl.trim()).digest('hex')
}

let sharedBrowser: AgentBrowser | null = null

function getCareerBrowser(): AgentBrowser {
  if (!sharedBrowser) {
    sharedBrowser = new AgentBrowser({
      cdpUrl: getSharedCdpUrl(),
      scope: 'shared',
      headless: false,
      excludeTools: ['browser_screenshot'],
    })
  }
  return sharedBrowser
}

let activeAbort: AbortController | null = null
let activeRunPromise: Promise<void> | null = null

export function isCareerCheckRunning(): boolean {
  return activeAbort !== null
}

export function stopCareerCheck(): void {
  activeAbort?.abort()
}

export async function stopCareerCheckAndWait(): Promise<void> {
  if (!activeAbort) return
  activeAbort.abort()
  if (activeRunPromise) {
    await activeRunPromise.catch(() => {})
  }
}

interface PageScanContext {
  signal: AbortSignal
  scanned: number
  relevant: number
  skipped: number
}

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const parts = Object.entries(args as Record<string, unknown>)
    .filter(([key]) => key !== '__mastraMetadata')
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

async function logCareerStep(
  event: { toolCalls: ToolCallChunk[]; toolResults: ToolResultChunk[] },
  signal: AbortSignal,
): Promise<void> {
  const devLogs = isDevLogs()
  let navigated = false
  for (const call of event.toolCalls) {
    if (devLogs) pushLog(CAREERS_TAB, `→ ${call.payload.toolName}${formatToolArgs(call.payload.args)}`)
    logger.info({ tool: call.payload.toolName, args: call.payload.args }, 'careers: tool call')
    if (NAVIGATION_TOOLS.has(call.payload.toolName)) navigated = true
  }
  for (const result of event.toolResults) {
    const status = result.payload.isError ? 'error' : 'ok'
    if (devLogs) pushLog(CAREERS_TAB, `← ${result.payload.toolName} (${status})`)
    logger.info(
      { tool: result.payload.toolName, isError: result.payload.isError, result: result.payload.result },
      'careers: tool result',
    )
  }

  if (navigated && !signal.aborted) {
    const delay = randomNavDelayMs()
    if (delay > 0) {
      await sleep(delay, signal)
    }
  }
}

function createCheckPostingSeenTool() {
  return createTool({
    id: 'check-posting-seen',
    description:
      "Check whether a posting (by its apply URL) has already been judged in a previous /check-careers run. Call this BEFORE reading/judging a posting's detail — if seen is true, skip it entirely, do not re-judge it, do not call report-posting-verdict for it.",
    inputSchema: z.object({ applyUrl: z.string() }),
    outputSchema: z.object({ seen: z.boolean() }),
    execute: async ({ applyUrl }) => {
      const id = applyUrlToJobId(applyUrl)
      const db = getDb()
      const rows = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id))
      const seen = rows.length > 0
      if (seen) {
        pushLog(CAREERS_TAB, `Skipping a posting (${applyUrl}) — already judged in an earlier check.`)
      }
      return { seen }
    },
  })
}

function createReportPostingVerdictTool(ctx: PageScanContext, sourceUrl: string) {
  return createTool({
    id: 'report-posting-verdict',
    description:
      'Report your relevance judgment for a NEW job posting you just read on this career page (one check-posting-seen did NOT flag as seen). Call this exactly once per new posting you judge.',
    inputSchema: z.object({
      title: z.string(),
      company: z.string(),
      location: z.string().optional(),
      applyUrl: z.string(),
      verdict: z.enum(['relevant', 'skip']),
      reason: z.string(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input) => {
      ctx.scanned++

      if (input.verdict === 'relevant') {
        ctx.relevant++
        const id = applyUrlToJobId(input.applyUrl)
        const db = getDb()
        // check-posting-seen already gates re-judgment, but onConflictDoNothing
        // + only notifying on a real insert stays as a second safety net —
        // mirrors the pattern in search-agent.ts's report-job.
        const inserted = await db
          .insert(jobs)
          .values({
            id,
            title: input.title,
            company: input.company,
            location: input.location ?? null,
            applyUrl: input.applyUrl,
            applyType: 'external',
            sourceUrl,
            source: 'career_page',
            status: 'external_saved',
            relevanceReason: input.reason,
          })
          .onConflictDoNothing()
          .returning({ id: jobs.id })

        if (inserted.length > 0) {
          notify({ kind: 'external-job-found', title: input.title, company: input.company, applyUrl: input.applyUrl })
          pushLog(CAREERS_TAB, `Reviewed "${input.title}" at ${input.company} — suitable. Saved and notified.`)
        } else {
          pushLog(CAREERS_TAB, `Reviewed "${input.title}" at ${input.company} — suitable, but already recorded from an earlier check.`)
        }
      } else {
        ctx.skipped++
        pushLog(CAREERS_TAB, `Reviewed "${input.title}" at ${input.company} — not a match, skipped. Reason: ${input.reason}`)
      }

      return { ok: true }
    },
  })
}

function createRequestHumanInputTool() {
  return createTool({
    id: 'request-human-input',
    description:
      'Ask the human for help when stuck (unusual page layout, login wall, CAPTCHA, or anything else you cannot resolve yourself). Waits for their typed reply, then returns it as the answer.',
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
    execute: async ({ question }) => {
      pushLog(CAREERS_TAB, `Needs input: ${question}`)
      const answer = await waitForAnswer(CAREERS_TAB, question)
      setAgentStatus(CAREERS_TAB, 'running')
      pushLog(CAREERS_TAB, `Got answer: ${answer}`)
      return { answer }
    },
  })
}

async function buildPageScanInstructions(pageUrl: string, pageLabel: string): Promise<string> {
  const config = getCurrentConfig()
  const resume = await loadResume(config.profileFiles.resume)
  const profile = await loadProfile(config.profileFiles.profile)

  return `
You are scanning "${pageLabel}"'s external career/jobs listing page (${pageUrl}) in a real,
already-open browser tab. This is NOT LinkedIn — every site's layout is different, so find the
postings list however this particular page structures it (a table, a list of cards, an embedded
job board widget, etc).

Candidate resume:
${resume}

Candidate profile (structured):
${JSON.stringify(profile, null, 2)}

Hiring requirements to match against:
${config.requirements}

CRITICAL RULE: report-posting-verdict is the ONLY way a posting is recorded. If you judge a posting
and do NOT call report-posting-verdict for it, that judgment is silently lost. Only call it for a
posting check-posting-seen did NOT flag as already seen — a seen posting must not be re-judged.

Process:
1. Take a browser_snapshot (interactiveOnly: true unless you need descriptive text) to find the
   postings list on the page.
2. For each posting: get its apply link first (the URL a candidate would land on to actually apply —
   construct the full absolute URL if the page only shows a relative href), then call
   check-posting-seen with that applyUrl BEFORE reading anything else about the posting. If seen is
   true, skip it entirely — do not read its detail, do not judge it, move to the next posting. This
   matters: re-judging an already-seen posting wastes effort for no benefit, since it's already
   recorded.
3. If not seen: read its title, company (usually "${pageLabel}" itself, but use whatever the page
   actually states), location if shown, and enough of the description to judge it — either from an
   already-visible summary/card, or by opening its detail (click or navigate) if the page requires
   that to see real content.
4. Judge relevance by substance, not literal title match: a posting counts as relevant if its real
   responsibilities/stack overlap meaningfully with the candidate's actual skills and experience,
   even if the title differs. Still respect the requirements text's hard constraints (seniority,
   location, experience range).
5. Call report-posting-verdict with title, company, location, applyUrl, verdict ("relevant" or
   "skip"), and a short reason.
6. If there's pagination or a "load more" control and you haven't yet covered all postings, use it
   and continue from step 1 for the newly-loaded postings.
7. If you hit a login wall, CAPTCHA, or a page structure you genuinely cannot make sense of, call
   request-human-input with a clear question, then continue once answered.

Be economical: an already-seen posting costs you one check-posting-seen call and nothing else — no
detail read, no judgment. Don't take a fresh browser_snapshot unless the visible content actually
changed (new page, new postings loaded).

Work through every posting visible on this page (and any further pages/loads it offers) before
finishing your turn.
`.trim()
}

export async function runCareerCheck(): Promise<void> {
  if (isCareerCheckRunning()) throw new Error('A career-page check is already running')

  const db = getDb()
  const pages = await db.select().from(careerPages)
  if (pages.length === 0) {
    pushLog(CAREERS_TAB, 'No career pages tracked yet — use /add-career-url first.')
    return
  }

  const abort = new AbortController()
  activeAbort = abort

  const run = (async () => {
    try {
      const browser = getCareerBrowser()

      for (const page of pages) {
        if (abort.signal.aborted) break

        setAgentStatus(CAREERS_TAB, 'running', `scanning ${page.label}`)
        pushLog(CAREERS_TAB, `Scanning ${page.label} (${page.url})`)

        const scanId = randomUUID()
        await db.insert(careerPageScans).values({ id: scanId, careerPageId: page.id })

        const ctx: PageScanContext = { signal: abort.signal, scanned: 0, relevant: 0, skipped: 0 }

        try {
          const instructions = await buildPageScanInstructions(page.url, page.label)
          const agent = new Agent({
            id: 'career-scan-agent',
            name: 'Career Page Scan Agent',
            instructions,
            model: appState.settings.model,
            browser,
            inputProcessors: [noOpBrowserContextProcessor],
            tools: {
              checkPostingSeen: createCheckPostingSeenTool(),
              reportPostingVerdict: createReportPostingVerdictTool(ctx, page.url),
              requestHumanInput: createRequestHumanInputTool(),
            },
          })

          await agent.generate(`Open ${page.url} in a new browser tab and scan it for job postings.`, {
            abortSignal: abort.signal,
            onStepFinish: (event) => logCareerStep(event, abort.signal),
            // Same maxSteps-defaults-to-5 gotcha as the other agents — budget
            // generously per posting, reusing maxJobsPerRun as a per-page cap.
            maxSteps: Math.max(60, appState.settings.maxJobsPerRun * 8),
          })
        } catch (err) {
          if (abort.signal.aborted) {
            pushLog(CAREERS_TAB, `Aborted while scanning ${page.label}.`)
          } else {
            pushLog(CAREERS_TAB, `Error scanning ${page.label}: ${err instanceof Error ? err.message : String(err)}`)
            logger.error({ err, page: page.url }, 'careers: page scan failed')
          }
        }

        await db
          .update(careerPageScans)
          .set({ finishedAt: new Date(), scannedCount: ctx.scanned, relevantCount: ctx.relevant, skippedCount: ctx.skipped })
          .where(eq(careerPageScans.id, scanId))
        await db.update(careerPages).set({ lastCheckedAt: new Date() }).where(eq(careerPages.id, page.id))

        pushLog(
          CAREERS_TAB,
          `Finished ${page.label}: reviewed ${ctx.scanned} posting(s), ${ctx.relevant} added to the queue, ${ctx.skipped} skipped.`,
        )

        if (abort.signal.aborted) break
        await sleep(randomNavDelayMs(), abort.signal)
      }

      pushLog(CAREERS_TAB, abort.signal.aborted ? 'Career-page check stopped early.' : 'Career-page check finished.')
    } finally {
      activeAbort = null
      // Always drop back to idle, even when a DB write outside the per-page
      // try/catch threw — otherwise the sidebar stays stuck on "running".
      setAgentStatus(CAREERS_TAB, 'idle', null)
    }
  })()

  activeRunPromise = run.finally(() => {
    activeRunPromise = null
  })
  await run
}
