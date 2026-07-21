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
import { loadResume, loadProfile } from '../profile/loader.ts'
import { appState, pushLog, setAgentStatus } from '../state/app-state.ts'
import { waitForAnswer } from '../state/prompt-channel.ts'
import { enqueueApplyJob, type ApplyType } from '../queues/apply-queues.ts'
import { noOpBrowserContextProcessor } from './no-op-browser-context-processor.ts'
import { logger } from '../utils/logger.ts'
import { isDevLogs } from '../utils/dev-mode.ts'
import type { AppConfig } from '../config/schema.ts'
import type { TabId } from '../state/types.ts'

const SEARCH_TAB: TabId = 'search'

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
  bailRatio: number
  /** Hard cap on jobs opened this run — see computeMidPageContinueDecision. */
  maxJobsPerRun: number
  signal: AbortSignal
  scanned: number
  relevant: number
  skipped: number
  /** How many times the agent called check-already-seen this run. Used only to
   * detect the "agent did work but never reported a verdict" failure mode, where
   * scanned stays 0 despite the agent clearly having inspected cards. */
  checkedSeen: number
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

/** Below this many scanned jobs, the bail ratio is not applied — a page has
 * 10+ jobs, and 1 skip out of 1-2 scanned jobs is not a meaningful signal
 * that the whole page is irrelevant. Without this floor a single early skip
 * (ratio 1/1 or 1/2, both >= a typical 0.5 bailRatio) closed the tab after
 * just one card. */
const MIN_SCANNED_BEFORE_BAIL = 4

/** Hard mid-page stop conditions only — abort or the per-run job cap. The
 * bail ratio is deliberately NOT checked here: it's evaluated once per page,
 * by computeNextPageDecision, so a couple of early skips never cut a page
 * short before every card on it has been read. Pure so it's testable. */
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

/** Called once a page's cards are all scanned, to decide whether to load the
 * next page/more results for this search URL, or stop here. Pure so it's
 * testable without a DB/queue in the loop. */
export function computeNextPageDecision(ctx: {
  scanned: number
  skipped: number
  bailRatio: number
  aborted: boolean
  /** Optional hard cap on jobs opened per run (LinkedIn rate-limit guard). Omit for no cap. */
  maxJobsPerRun?: number
}): boolean {
  if (ctx.aborted) return false
  // Rate-limit guard: once the run has opened its budget of jobs, stop — this
  // bounds how hard a single run hammers LinkedIn regardless of the bail ratio.
  if (ctx.maxJobsPerRun !== undefined && ctx.scanned >= ctx.maxJobsPerRun) return false
  if (ctx.scanned < MIN_SCANNED_BEFORE_BAIL) return true
  return ctx.skipped / ctx.scanned < ctx.bailRatio
}

function createCheckAlreadySeenTool(ctx: ScanRunContext) {
  return createTool({
    id: 'check-already-seen',
    description:
      "Check whether a LinkedIn job posting has already been scanned in a previous run. Call this BEFORE opening a job's detail page, using the numeric job id from its URL (the digits after /jobs/view/).",
    inputSchema: z.object({ jobId: z.string() }),
    outputSchema: z.object({ seen: z.boolean() }),
    execute: async ({ jobId }) => {
      ctx.checkedSeen++
      const db = getDb()
      const rows = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId))
      const seen = rows.length > 0
      if (seen) {
        pushLog(SEARCH_TAB, `Skipping a job (id ${jobId}) — already reviewed in an earlier run.`)
      }
      return { seen }
    },
  })
}

function createReportJobVerdictTool(ctx: ScanRunContext) {
  return createTool({
    id: 'report-job-verdict',
    description:
      "Report your relevance judgment for a job you just read. Call this exactly once per newly-opened job (never for one check-already-seen already marked seen). Returns whether to keep scanning this page — this is only a hard stop (rate-limit cap or abort), NOT a relevance-ratio decision, so a skip verdict on its own never ends the page.",
    inputSchema: z.object({
      jobId: z.string(),
      title: z.string(),
      company: z.string(),
      location: z.string().optional(),
      sourceUrl: z.string(),
      applyUrl: z.string(),
      verdict: z.enum(['relevant', 'skip']),
      applyType: z.enum(['easy', 'external']).optional(),
      reason: z.string(),
    }),
    outputSchema: z.object({ continue: z.boolean() }),
    execute: async (input) => {
      ctx.scanned++

      if (input.verdict === 'relevant') {
        ctx.relevant++
        const applyType: ApplyType = input.applyType ?? 'easy'
        const db = getDb()
        // .returning() tells us whether this insert actually happened (vs.
        // conflicting with an existing row) — only enqueue on a real insert,
        // so a job already in the DB (e.g. the model skipped check-already-seen)
        // never gets queued twice.
        const inserted = await db
          .insert(jobs)
          .values({
            id: input.jobId,
            title: input.title,
            company: input.company,
            location: input.location ?? null,
            applyUrl: input.applyUrl,
            applyType,
            sourceUrl: input.sourceUrl,
            status: 'discovered',
            relevanceReason: input.reason,
          })
          .onConflictDoNothing()
          .returning({ id: jobs.id })

        const queueName = applyType === 'easy' ? 'Easy Apply' : 'external apply'
        if (inserted.length > 0) {
          await enqueueApplyJob(applyType, input.jobId)
          pushLog(
            SEARCH_TAB,
            `Reviewed "${input.title}" at ${input.company} (id ${input.jobId}) — suitable. Added to the ${queueName} queue.`,
          )
        } else {
          pushLog(
            SEARCH_TAB,
            `Reviewed "${input.title}" at ${input.company} (id ${input.jobId}) — suitable, but already found earlier, so not queued again.`,
          )
        }
      } else {
        ctx.skipped++
        pushLog(
          SEARCH_TAB,
          `Reviewed "${input.title}" at ${input.company} (id ${input.jobId}) — not a match, skipped. Reason: ${input.reason}`,
        )
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

function createCheckPageBailTool(ctx: ScanRunContext) {
  return createTool({
    id: 'check-page-bail',
    description:
      "Call this ONCE, after you have selected and reported every card currently in your traversal list for this page, and BEFORE loading more results — whether that means clicking a 'Next' pagination control or letting an infinite-scroll page load more cards. Decides whether this search URL is worth continuing based on how irrelevant the jobs scanned so far turned out to be. Do not call this mid-page, between cards.",
    inputSchema: z.object({}),
    outputSchema: z.object({ continueToNextPage: z.boolean() }),
    execute: async () => {
      const continueToNextPage = computeNextPageDecision({
        scanned: ctx.scanned,
        skipped: ctx.skipped,
        bailRatio: ctx.bailRatio,
        aborted: ctx.signal.aborted,
        maxJobsPerRun: ctx.maxJobsPerRun,
      })
      if (!continueToNextPage && ctx.scanned > 0) {
        const reason =
          ctx.maxJobsPerRun !== undefined && ctx.scanned >= ctx.maxJobsPerRun
            ? `reached the per-run limit of ${ctx.maxJobsPerRun} jobs`
            : `${ctx.skipped}/${ctx.scanned} jobs scanned so far were irrelevant`
        pushLog(SEARCH_TAB, `Stopping this search URL — ${reason}.`)
      }
      return { continueToNextPage }
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

function createReturnUrlsTool(collected: string[]) {
  return createTool({
    id: 'return-urls',
    description: 'Return the final list of LinkedIn job search URLs you generated. Call this exactly once when done.',
    inputSchema: z.object({ urls: z.array(z.url()) }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async ({ urls }) => {
      collected.push(...urls)
      return { ok: true }
    },
  })
}

export async function buildScanInstructions(config: AppConfig): Promise<string> {
  const resume = await loadResume(config.profileFiles.resume)
  const profile = await loadProfile(config.profileFiles.profile)

  return `
You are a LinkedIn job search assistant operating a real, already-logged-in browser.

Candidate resume:
${resume}

Candidate profile (structured):
${JSON.stringify(profile, null, 2)}

Hiring requirements to match against:
${config.requirements}

CRITICAL RULE: report-job-verdict is the ONLY way a job is recorded and queued. If you select a
job and do NOT call report-job-verdict for it, that job is silently lost — all your reading was
wasted. You MUST call report-job-verdict exactly once for every job you select, before you move on
to the next card.

Process the cards STRICTLY ONE AT A TIME. Do not skim multiple cards and then go back — finish a
card completely (check → select → judge → report) before touching the next one.

=== HOW TO BROWSE JOBS (like a normal user, not an API) ===
1. Open the given search results URL in a NEW browser tab (browser_tabs action "new", pointed at the
   exact URL you were given) — do not modify it into a different endpoint, and do not reuse/navigate
   the existing LinkedIn tab. This is the real LinkedIn Jobs search page: a left-hand column lists
   job cards, and a right-hand pane shows the full detail/description of whichever card is currently
   selected. Stay in this tab and interact with it purely by clicking, the way a person would —
   never browser_goto to a different URL to "open" a job.
2. Take a browser_snapshot of the page. In it, find the left-hand job list: it is an ordered list of
   clickable job-card elements (each one's ref usually has a job title/company as its accessible
   name, and each corresponds to an <li> with a "data-occludable-job-id" attribute in the real DOM).
   Write down this list of refs, top to bottom, in order — this is your traversal order for the
   current page, position 1 = the first card. The currently-selected card (position 1 on first load)
   is visually/semantically marked active (e.g. aria-current="page", or a class containing "active"/
   "selected" on it or its container) and its detail already shows in the right-hand pane.
3. Read the selected card's detail from the right pane (title, company, location, full description,
   and the apply button: "Easy Apply" means applyType "easy", any other "Apply" button that hands
   off to an external site means applyType "external"). Get the job id from the "currentJobId" query
   param in the tab's current URL; if the URL hasn't updated yet, use the selected card's
   data-occludable-job-id (or data-job-id) attribute instead. Never invent a job id — if you truly
   cannot extract one, skip this card and move to the next position anyway.
4. Call check-already-seen with that jobId. If seen is true, skip it — no further action for this
   card. (Do not call report-job-verdict for a seen job.)
5. If not seen, judge relevance against the resume, profile, and requirements above using the detail
   pane content already showing — do not open any separate page. Judge by substance, not literal title match:
   a job counts as relevant if its actual responsibilities/stack overlap meaningfully with the
   candidate's real skills and experience, even if the job title itself differs from anything in the
   candidate's history (e.g. a "Platform Engineer" posting that's really full-stack TypeScript work is
   relevant to a "Full Stack Developer" candidate whose stack matches). Weigh the candidate's
   demonstrated skills more heavily than title wording when deciding overlap. Still be reasonably
   selective on the requirements text's hard constraints — skip jobs that clearly mismatch seniority,
   location, or stated experience-range requirements.
6. Call report-job-verdict with the jobId, title, company, location, sourceUrl (the search results
   URL you were given), applyUrl (construct the canonical https://www.linkedin.com/jobs/view/<jobId>/
   from the jobId — you don't need to have navigated there), verdict ("relevant" or "skip"),
   applyType, and a short reason. Mandatory for EVERY selected job — a "skip" verdict still requires
   the call. This call almost always returns continue: true — that's just a hard rate-limit/abort
   check, NOT a relevance judgment, so a "skip" verdict never by itself ends the page. If it ever
   returns continue: false, stop entirely: close this tab (browser_tabs action "close") and finish
   your turn immediately, skipping the rest of the steps below.
7. Otherwise — continue: true, the normal case — you are NOT done. Advance to the NEXT position in
   your traversal list from step 2 (position 2, then 3, then 4, ...) and browser_click that card's
   ref to select it. This updates the right pane and the currentJobId in place, no page reload. Go
   back to step 3 for this newly-selected card. Do this for EVERY remaining card on the page, one at
   a time, without stopping in between and regardless of how many skips you've hit in a row —
   reaching the end of the traversal list, not any single verdict, is what ends this page.
8. Once you have selected and reported every card that was in your step-2 traversal list (the whole
   page, not a subset), call check-page-bail exactly once. This looks at how irrelevant the jobs on
   THIS page turned out to be overall and decides whether continuing to more results for this search
   URL is worth it.
   - If continueToNextPage is false, close this tab (browser_tabs action "close") and finish your
     turn — do not load more pages for this search URL.
   - If continueToNextPage is true, take a fresh browser_snapshot: if the left-hand list now shows
     more cards than before (LinkedIn infinite-scrolls more in), re-run step 2 to build a new
     traversal list starting after the last card you already handled, and keep going. If instead
     there's a pagination control at the bottom (e.g. a "Next"/page-number button), click it to load
     the next page of results in this SAME tab, then start over from step 2 for the new page. If
     there is no more content and no next-page control, close this tab (browser_tabs action "close")
     and finish your turn.
9. If you hit a LinkedIn checkpoint, CAPTCHA, or any page that isn't the normal jobs search UI, call
   request-human-input with a clear question describing what you're stuck on, then wait for the
   answer before continuing.

DO NOT STOP after just the first (auto-selected) card, after a skip verdict, or after just one page.
Finishing every card on a page before ever calling check-page-bail, and continuing to the next page
when it says to, is the default behavior — the ONLY things that legitimately end this search URL are:
report-job-verdict returning continue: false (hard rate-limit/abort stop, can happen mid-page),
check-page-bail returning continueToNextPage: false (checked only once a whole page is done), running
out of both cards and a next-page control, or getting stuck badly enough to need request-human-input.

Notes / gotchas:
- Selecting a card (browser_click) is paced the same as opening a page — there's an automatic,
  enforced pause after it before your next step runs, the same way a real person would pause to read
  before clicking the next job. You don't need to add your own waits.
- Be economical: read everything you need for a card from the already-visible detail pane in one
  pass, don't re-select a card you already judged, and don't reload the search results between jobs.
  Fewer, purposeful actions keep the account safe.
- Token economy matters too, not just navigation pacing: only take a fresh browser_snapshot when you
  actually need the traversal-list refs (start of a page, or after new cards load in) — after clicking
  a card, read its detail straight from the click result / already-visible pane rather than
  re-snapshotting the whole page. When you do need a snapshot, pass interactiveOnly: true unless you
  specifically need descriptive text — the full accessibility tree of a busy jobs page is the single
  biggest cost in this conversation, and it compounds across every card on the page.

Work through the ENTIRE page, and the next page after that (per the rules above), stopping only per
the conditions listed. Before you finish your turn, double-check: did you call report-job-verdict
once for every card you selected, and did you actually reach one of the legitimate stop conditions
rather than just pausing after one job? If not, keep going.
`.trim()
}

export interface SearchRunResult {
  scanned: number
  relevant: number
  skipped: number
  urlsTried: string[]
}

export function runSearchUrls(config: AppConfig, urls: string[]): Promise<SearchRunResult> {
  const run = runSearchUrlsInner(config, urls)
  activeRunPromise = run.finally(() => {
    activeRunPromise = null
  })
  return run
}

async function runSearchUrlsInner(config: AppConfig, urls: string[]): Promise<SearchRunResult> {
  if (isSearchRunning()) throw new Error('A search is already running')
  if (urls.length === 0) {
    pushLog(SEARCH_TAB, 'No search URLs to run.')
    return { scanned: 0, relevant: 0, skipped: 0, urlsTried: [] }
  }

  const abort = new AbortController()
  activeAbort = abort

  const db = getDb()
  const runId = randomUUID()
  await db.insert(searchRuns).values({ id: runId, urlsTried: [] })

  const ctx: ScanRunContext = {
    bailRatio: 0.5,
    maxJobsPerRun: appState.settings.maxJobsPerRun,
    signal: abort.signal,
    scanned: 0,
    relevant: 0,
    skipped: 0,
    checkedSeen: 0,
  }

  try {
    const instructions = await buildScanInstructions(config)
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
        reportJobVerdict: createReportJobVerdictTool(ctx),
        checkPageBail: createCheckPageBailTool(ctx),
        requestHumanInput: createRequestHumanInputTool(),
      },
    })

    const triedUrls: string[] = []
    for (const url of urls) {
      ctx.bailRatio = 0.5
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
          // several steps: snapshot, check-already-seen, report-job-verdict, click
          // next). Without this the agent silently stopped after ~1 job per URL.
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
          relevantCount: ctx.relevant,
          skippedCount: ctx.skipped,
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

    // The whole pipeline hinges on the agent calling report-job-verdict — that's
    // the only path that increments scanned and enqueues apply jobs. If the agent
    // inspected cards (called check-already-seen) but never reported a single
    // verdict, the run "succeeded" with scanned=0 and queued nothing. Surface that
    // loudly instead of letting a silent 0/0/0 look like an empty search.
    if (!abort.signal.aborted && ctx.scanned === 0 && ctx.checkedSeen > 0) {
      const warning = `WARNING: agent checked ${ctx.checkedSeen} job(s) but never called report-job-verdict, so nothing was recorded or queued. Likely the model skipped the reporting step — try a stronger model via /set model.`
      pushLog(SEARCH_TAB, warning)
      logger.warn({ checkedSeen: ctx.checkedSeen, scanned: ctx.scanned }, 'search: agent reported no verdicts')
    }

    const stopped = abort.signal.aborted ? ' (stopped early)' : ''
    const summary =
      ctx.scanned === 0
        ? `Finished searching ${triedUrls.length} page(s)${stopped}. No new jobs to review.`
        : `Finished searching ${triedUrls.length} page(s)${stopped}. Reviewed ${ctx.scanned} new job(s): ${ctx.relevant} added to the apply queue, ${ctx.skipped} skipped.`
    pushLog(SEARCH_TAB, summary)
    logger.info(
      { scanned: ctx.scanned, relevant: ctx.relevant, skipped: ctx.skipped, urls: triedUrls.length },
      'search: run finished',
    )
    setAgentStatus(SEARCH_TAB, 'idle', null)

    return { scanned: ctx.scanned, relevant: ctx.relevant, skipped: ctx.skipped, urlsTried: triedUrls }
  } finally {
    activeAbort = null
    // Always drop back to idle — without this, a thrown error (surfaced to the
    // user by the command layer) left the sidebar stuck on "running" forever.
    setAgentStatus(SEARCH_TAB, 'idle', null)
  }
}

async function generateSearchUrls(task: string): Promise<string[]> {
  const collected: string[] = []
  const agent = new Agent({
    id: 'search-url-generator',
    name: 'Search URL Generator',
    model: appState.settings.model,
    instructions:
      'Convert the given job-search description into 1-3 LinkedIn job search URLs (https://www.linkedin.com/jobs/search/?...). Use appropriate keywords and location query params, and f_TPR=r86400 for last-24h postings when reasonable. Respond only by calling the return-urls tool exactly once.',
    tools: { returnUrls: createReturnUrlsTool(collected) },
  })
  await agent.generate(task)
  return collected
}

export async function generateSearchUrlsFromText(freeText: string): Promise<string[]> {
  return generateSearchUrls(freeText)
}

export async function generateSearchUrlsFromResume(config: AppConfig): Promise<string[]> {
  const resume = await loadResume(config.profileFiles.resume)
  return generateSearchUrls(`Infer search filters from this resume and generate LinkedIn search URLs:\n\n${resume}`)
}
