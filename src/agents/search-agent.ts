import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { AgentBrowser } from '@mastra/agent-browser'
import type { ToolCallChunk, ToolResultChunk } from '@mastra/core/stream'
import { getSharedCdpUrl } from '../browser/session.ts'
import { getDb } from '../db/index.ts'
import { jobs, searchRuns } from '../db/schema.ts'
import { appState, pushLog, setAgentStatus } from '../state/app-state.ts'
import { waitForAnswer } from '../state/prompt-channel.ts'
import { enqueueApplyJob } from '../queues/apply-queues.ts'
import { notify } from '../notify/notify.ts'
import { noOpBrowserContextProcessor } from './no-op-browser-context-processor.ts'
import { logger } from '../utils/logger.ts'
import { isDevLogs } from '../utils/dev-mode.ts'

const SEARCH_TAB = 'search' as const

/** Browser tools that actually hit LinkedIn over the network — these are the
 * ones we pace to stay under LinkedIn's automation-detection thresholds. Local
 * tools (snapshot/evaluate/screenshot) inspect the already-loaded page and are
 * not throttled. */
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

/** Randomized human-like pause length from the live settings bounds. Jitter
 * matters: a fixed cadence is itself a bot signal. */
function randomNavDelayMs(): number {
  const min = Math.max(0, appState.settings.minNavDelayMs)
  const max = Math.max(min, appState.settings.maxNavDelayMs)
  return min + Math.floor(Math.random() * (max - min + 1))
}

let sharedBrowser: AgentBrowser | null = null

function getSearchBrowser(): AgentBrowser {
  if (!sharedBrowser) {
    // Default model (opencode-go/deepseek-v4-flash) is text-only — drop the
    // screenshot tool so the agent never hands it an image it can't read.
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
let activeRunPromise: Promise<SearchRunResult> | null = null

export function isSearchRunning(): boolean {
  return activeAbort !== null
}

export function stopSearch(): void {
  activeAbort?.abort()
}

/** Aborts the in-flight search (if any) and waits for it to actually unwind — used on app shutdown so the search agent doesn't keep calling a browser that's about to be killed. */
export async function stopSearchAndWait(): Promise<void> {
  if (!activeAbort) return
  activeAbort.abort()
  if (activeRunPromise) {
    await activeRunPromise.catch(() => {})
  }
}

interface ScanRunContext {
  /** Hard cap on jobs opened this run — see computeMidPageContinueDecision. */
  maxJobsPerRun: number
  signal: AbortSignal
  scanned: number
  queued: number
  externalSaved: number
}

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const parts = Object.entries(args as Record<string, unknown>)
    .filter(([key]) => key !== '__mastraMetadata')
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

/**
 * Logs every tool call/result of an agent step, and — critically — enforces the
 * inter-navigation rate limit. The raw `→ tool` / `← tool` trace is developer
 * noise: it only reaches the TUI log panel when DEV_LOGS is on. The natural-
 * language flow a normal user reads is emitted by the tools themselves, not
 * here. Regardless of DEV_LOGS, the full trace always goes to the on-disk log
 * file so a stalled run is still diagnosable.
 *
 * This is an `onStepFinish` handler; Mastra awaits it, so awaiting a sleep here
 * throttles the whole agent loop in code — it does NOT depend on the model
 * choosing to pace itself. Any step that issued a network-hitting browser
 * navigation earns a randomized human-like pause before the next step runs.
 */
async function logSearchStep(
  event: { toolCalls: ToolCallChunk[]; toolResults: ToolResultChunk[] },
  signal: AbortSignal,
): Promise<void> {
  const devLogs = isDevLogs()
  let navigated = false
  for (const call of event.toolCalls) {
    if (devLogs) pushLog(SEARCH_TAB, `→ ${call.payload.toolName}${formatToolArgs(call.payload.args)}`)
    logger.info({ tool: call.payload.toolName, args: call.payload.args }, 'search: tool call')
    if (NAVIGATION_TOOLS.has(call.payload.toolName)) navigated = true
  }
  for (const result of event.toolResults) {
    const status = result.payload.isError ? 'error' : 'ok'
    if (devLogs) pushLog(SEARCH_TAB, `← ${result.payload.toolName} (${status})`)
    logger.info(
      { tool: result.payload.toolName, isError: result.payload.isError, result: result.payload.result },
      'search: tool result',
    )
  }

  if (navigated && !signal.aborted) {
    const delay = randomNavDelayMs()
    if (delay > 0) {
      if (devLogs) pushLog(SEARCH_TAB, `(pausing ${(delay / 1000).toFixed(1)}s to stay under LinkedIn rate limits)`)
      logger.info({ delayMs: delay }, 'search: rate-limit pause')
      await sleep(delay, signal)
    }
  }
}

/** Hard mid-page stop conditions only — abort or the per-run job cap. There is
 * no relevance-based bail: every job a configured search URL turns up gets
 * recorded, since the URL's own LinkedIn filters are trusted as the relevance
 * signal. Pure so it's testable. */
export function computeMidPageContinueDecision(ctx: {
  scanned: number
  aborted: boolean
  /** Optional hard cap on jobs opened per run (LinkedIn rate-limit guard). Omit for no cap. */
  maxJobsPerRun?: number
}): boolean {
  if (ctx.aborted) return false
  if (ctx.maxJobsPerRun !== undefined && ctx.scanned >= ctx.maxJobsPerRun) return false
  return true
}

function createCheckAlreadySeenTool(ctx: ScanRunContext) {
  return createTool({
    id: 'check-already-seen',
    description:
      "Check whether a LinkedIn job posting has already been recorded in a previous run. Call this BEFORE reading anything else about a card, using the numeric job id from its URL (the digits after /jobs/view/) or its data-occludable-job-id/data-job-id attribute. If seen is true, skip this card immediately — do not read its detail pane, do not call report-job for it.",
    inputSchema: z.object({ jobId: z.string() }),
    outputSchema: z.object({ seen: z.boolean() }),
    execute: async ({ jobId }) => {
      const db = getDb()
      const rows = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId))
      const seen = rows.length > 0
      if (seen) {
        pushLog(SEARCH_TAB, `Skipping a job (id ${jobId}) — already recorded in an earlier run.`)
      }
      return { seen }
    },
  })
}

function createReportJobTool(ctx: ScanRunContext) {
  return createTool({
    id: 'report-job',
    description:
      "Record a newly-found job (one check-already-seen did NOT flag as seen) and route it. Call this exactly once per new card. There is no relevance judgment to make — every new job a configured search URL surfaces gets recorded, since the search URL's own LinkedIn filters are the relevance signal. Returns whether to keep scanning (a hard rate-limit/abort check only, never a relevance decision).",
    inputSchema: z.object({
      jobId: z.string(),
      title: z.string(),
      company: z.string(),
      location: z.string().optional(),
      sourceUrl: z.string(),
      applyUrl: z.string(),
      applyType: z.enum(['easy', 'external']),
    }),
    outputSchema: z.object({ continue: z.boolean() }),
    execute: async (input) => {
      ctx.scanned++

      const db = getDb()
      const status = input.applyType === 'easy' ? 'queued' : 'external_saved'
      // .returning() tells us whether this insert actually happened (vs.
      // conflicting with an existing row) — only route on a real insert, so a
      // job already in the DB (e.g. the model skipped check-already-seen)
      // never gets queued/notified twice.
      const inserted = await db
        .insert(jobs)
        .values({
          id: input.jobId,
          title: input.title,
          company: input.company,
          location: input.location ?? null,
          applyUrl: input.applyUrl,
          applyType: input.applyType,
          sourceUrl: input.sourceUrl,
          status,
        })
        .onConflictDoNothing()
        .returning({ id: jobs.id })

      if (inserted.length > 0) {
        if (input.applyType === 'easy') {
          ctx.queued++
          await enqueueApplyJob(input.jobId)
          pushLog(SEARCH_TAB, `Found "${input.title}" at ${input.company} (id ${input.jobId}) — added to the Easy Apply queue.`)
        } else {
          ctx.externalSaved++
          notify({ kind: 'external-job-found', title: input.title, company: input.company, applyUrl: input.applyUrl })
          pushLog(SEARCH_TAB, `Found "${input.title}" at ${input.company} (id ${input.jobId}) — external apply, saved and notified.`)
        }
      } else {
        pushLog(SEARCH_TAB, `Found "${input.title}" at ${input.company} (id ${input.jobId}) — already recorded, not routed again.`)
      }

      const shouldContinue = computeMidPageContinueDecision({
        scanned: ctx.scanned,
        aborted: ctx.signal.aborted,
        maxJobsPerRun: ctx.maxJobsPerRun,
      })
      if (!shouldContinue && ctx.scanned >= ctx.maxJobsPerRun) {
        pushLog(SEARCH_TAB, `Reached the per-run limit of ${ctx.maxJobsPerRun} jobs — stopping this page to avoid overusing LinkedIn.`)
      }
      return { continue: shouldContinue }
    },
  })
}

function createRequestHumanInputTool() {
  return createTool({
    id: 'request-human-input',
    description:
      'Ask the human for help when stuck (LinkedIn checkpoint, CAPTCHA, or anything else you cannot resolve yourself). Waits for their typed reply, then returns it as the answer.',
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
    execute: async ({ question }) => {
      pushLog(SEARCH_TAB, `Needs input: ${question}`)
      const answer = await waitForAnswer(SEARCH_TAB, question)
      setAgentStatus(SEARCH_TAB, 'running')
      pushLog(SEARCH_TAB, `Got answer: ${answer}`)
      return { answer }
    },
  })
}

export async function buildScanInstructions(): Promise<string> {
  return `
You are a LinkedIn job search assistant operating a real, already-logged-in browser. The search URL
you're given already encodes the user's own filters (keywords, location, date posted, etc.) — your
job is purely to walk its results and record every NEW job you find. There is no relevance judgment to make:
do not read a job's full description, do not weigh it against a resume or requirements — that step
does not exist in this flow.

CRITICAL RULE: report-job is the ONLY way a job is recorded and routed. If you select a job and do
NOT call report-job for it (because it wasn't already flagged seen), that job is silently lost.

Process the cards STRICTLY ONE AT A TIME, in order, without skipping ahead.

=== HOW TO BROWSE JOBS (like a normal user, not an API) ===
1. Open the given search results URL in a NEW browser tab (browser_tabs action "new", pointed at the
   exact URL you were given) — do not modify it into a different endpoint, and do not reuse/navigate
   the existing LinkedIn tab. This is the real LinkedIn Jobs search page: a left-hand column lists
   job cards, and a right-hand pane shows the full detail/description of whichever card is currently
   selected. Stay in this tab and interact with it purely by clicking, the way a person would.
2. Take a browser_snapshot of the page (interactiveOnly: true unless you specifically need
   descriptive text). In it, find the left-hand job list: an ordered list of clickable job-card
   elements. Write down this list of refs, top to bottom, in order — this is your traversal order
   for the current page, position 1 = the first card.
3. For the currently-selected card (position 1 on first load, or whichever you just clicked), get its
   job id from the "currentJobId" query param in the tab's current URL; if the URL hasn't updated
   yet, use the selected card's data-occludable-job-id (or data-job-id) attribute instead. Never
   invent a job id — if you truly cannot extract one, skip this card and move to the next position.
4. Call check-already-seen with that jobId BEFORE reading anything else about this card. If seen is
   true, do not read the detail pane at all — move straight to the next position in your traversal
   list (step 7). This matters: reading and reasoning about an already-seen card wastes effort for no
   benefit, since it will never be recorded again.
5. If not seen: read just enough from the already-visible right-hand detail pane to fill in
   report-job's fields — title, company, location, and whether the apply control says "Easy Apply"
   (applyType "easy") or hands off to an external site (applyType "external", any other apply-button
   label). Do not read the full job description — there is nothing to judge it against.
6. Call report-job with jobId, title, company, location, sourceUrl (the search results URL you were
   given), applyUrl (construct the canonical https://www.linkedin.com/jobs/view/<jobId>/ from the
   jobId — you don't need to have navigated there), and applyType. Mandatory for every new card. This
   call almost always returns continue: true — that's just a hard rate-limit/abort check. If it ever
   returns continue: false, stop entirely: close this tab (browser_tabs action "close") and finish
   your turn immediately.
7. Advance to the NEXT position in your traversal list (position 2, then 3, then 4, ...) and
   browser_click that card's ref to select it. This updates the right pane and the currentJobId in
   place, no page reload. Go back to step 3 for this newly-selected card. Do this for every remaining
   card on the page, one at a time, without stopping in between.
8. Once you have handled every card that was in your step-2 traversal list (the whole page, not a
   subset): take a fresh browser_snapshot. If the left-hand list now shows more cards than before
   (LinkedIn infinite-scrolls more in), re-run step 2 to build a new traversal list starting after the
   last card you already handled, and keep going from step 3. If instead there's a pagination control
   at the bottom (e.g. a "Next"/page-number button), click it to load the next page of results in this
   SAME tab, then start over from step 2 for the new page. If there is no more content and no
   next-page control, close this tab (browser_tabs action "close") and finish your turn.
9. If you hit a LinkedIn checkpoint, CAPTCHA, or any page that isn't the normal jobs search UI, call
   request-human-input with a clear question describing what you're stuck on, then wait for the
   answer before continuing.

DO NOT STOP after just the first (auto-selected) card or after just one page. Finishing every card on
a page, and continuing to the next page/scroll when there's more, is the default behavior — the ONLY
things that legitimately end this search URL are: report-job returning continue: false (hard
rate-limit/abort stop, can happen mid-page), running out of both cards and a next-page control, or
getting stuck badly enough to need request-human-input.

Notes / gotchas:
- Selecting a card (browser_click) is paced the same as opening a page — there's an automatic,
  enforced pause after it before your next step runs, the same way a real person would pause to read
  before clicking the next job. You don't need to add your own waits.
- Be economical: an already-seen card costs you one check-already-seen call and nothing else — no
  snapshot, no detail read. For a new card, read only what report-job needs, don't re-select a card
  you already handled, and don't reload the search results between jobs.
- Token economy matters too, not just navigation pacing: only take a fresh browser_snapshot when you
  actually need the traversal-list refs (start of a page, or after new cards load in) — after clicking
  a card, read its detail straight from the click result / already-visible pane rather than
  re-snapshotting the whole page.

Work through the ENTIRE page, and the next page after that (per the rules above), stopping only per
the conditions listed. Before you finish your turn, double-check: did you call report-job once for
every NEW card you selected, and did you actually reach one of the legitimate stop conditions rather
than just pausing after one job? If not, keep going.
`.trim()
}

export interface SearchRunResult {
  scanned: number
  queued: number
  externalSaved: number
  urlsTried: string[]
}

export function runSearchUrls(urls: string[]): Promise<SearchRunResult> {
  const run = runSearchUrlsInner(urls)
  activeRunPromise = run.finally(() => {
    activeRunPromise = null
  })
  return run
}

async function runSearchUrlsInner(urls: string[]): Promise<SearchRunResult> {
  if (isSearchRunning()) throw new Error('A search is already running')
  if (urls.length === 0) {
    pushLog(SEARCH_TAB, 'No search URLs to run.')
    return { scanned: 0, queued: 0, externalSaved: 0, urlsTried: [] }
  }

  const abort = new AbortController()
  activeAbort = abort

  const db = getDb()
  const runId = randomUUID()
  await db.insert(searchRuns).values({ id: runId, urlsTried: [] })

  const ctx: ScanRunContext = {
    maxJobsPerRun: appState.settings.maxJobsPerRun,
    signal: abort.signal,
    scanned: 0,
    queued: 0,
    externalSaved: 0,
  }

  try {
    const instructions = await buildScanInstructions()
    const browser = getSearchBrowser()
    const agent = new Agent({
      id: 'search-agent',
      name: 'Search Agent',
      instructions,
      model: appState.settings.model,
      browser,
      inputProcessors: [noOpBrowserContextProcessor],
      tools: {
        checkAlreadySeen: createCheckAlreadySeenTool(ctx),
        reportJob: createReportJobTool(ctx),
        requestHumanInput: createRequestHumanInputTool(),
      },
    })

    const triedUrls: string[] = []
    for (const url of urls) {
      if (abort.signal.aborted) break

      setAgentStatus(SEARCH_TAB, 'running', `scanning ${url}`)
      pushLog(SEARCH_TAB, `Scanning ${url}`)
      triedUrls.push(url)

      try {
        await agent.generate(`Search results URL to scan: ${url}`, {
          abortSignal: abort.signal,
          onStepFinish: (event) => logSearchStep(event, abort.signal),
          // Mastra's Agent.generate defaults maxSteps to 5 tool-call steps total —
          // nowhere near enough to click through a page of job cards (each card is
          // several steps: snapshot, check-already-seen, report-job, click next).
          // Budget generously per job scanned this run, with a floor so a low
          // maxJobsPerRun setting doesn't reintroduce the cap.
          maxSteps: Math.max(80, appState.settings.maxJobsPerRun * 10),
        })
      } catch (err) {
        if (abort.signal.aborted) {
          pushLog(SEARCH_TAB, 'Search aborted mid-step.')
          break
        }
        throw err
      }

      await db
        .update(searchRuns)
        .set({
          urlsTried: triedUrls,
          scannedCount: ctx.scanned,
          relevantCount: ctx.queued + ctx.externalSaved,
          skippedCount: 0,
        })
        .where(eq(searchRuns.id, runId))

      // Per-run job budget is cumulative across all URLs — once spent, don't
      // start scanning the next search URL. Rate-limit guard.
      if (ctx.scanned >= ctx.maxJobsPerRun) {
        pushLog(SEARCH_TAB, `Per-run job limit (${ctx.maxJobsPerRun}) reached — not scanning remaining search URLs.`)
        break
      }

      // Polite pause between search URLs so back-to-back page loads don't look
      // like a burst to LinkedIn.
      await sleep(randomNavDelayMs(), abort.signal)
    }

    await db.update(searchRuns).set({ finishedAt: new Date() }).where(eq(searchRuns.id, runId))

    const stopped = abort.signal.aborted ? ' (stopped early)' : ''
    const summary =
      ctx.scanned === 0
        ? `Finished searching ${triedUrls.length} page(s)${stopped}. No new jobs found.`
        : `Finished searching ${triedUrls.length} page(s)${stopped}. Found ${ctx.scanned} new job(s): ${ctx.queued} queued for Easy Apply, ${ctx.externalSaved} saved as external.`
    pushLog(SEARCH_TAB, summary)
    logger.info(
      { scanned: ctx.scanned, queued: ctx.queued, externalSaved: ctx.externalSaved, urls: triedUrls.length },
      'search: run finished',
    )
    setAgentStatus(SEARCH_TAB, 'idle', null)

    return { scanned: ctx.scanned, queued: ctx.queued, externalSaved: ctx.externalSaved, urlsTried: triedUrls }
  } finally {
    activeAbort = null
    // Always drop back to idle — without this, a thrown error (surfaced to the
    // user by the command layer) left the sidebar stuck on "running" forever.
    setAgentStatus(SEARCH_TAB, 'idle', null)
  }
}
