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
  /** Hard cap on jobs opened this run — see computeContinueDecision. */
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

/** Pure so it's testable without a DB/queue in the loop. */
export function computeContinueDecision(ctx: {
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
  if (ctx.scanned === 0) return true
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
      "Report your relevance judgment for a job you just read. Call this exactly once per newly-opened job (never for one check-already-seen already marked seen). Returns whether to keep scanning this page.",
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

      const shouldContinue = computeContinueDecision({
        scanned: ctx.scanned,
        skipped: ctx.skipped,
        bailRatio: ctx.bailRatio,
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

async function buildScanInstructions(config: AppConfig): Promise<string> {
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

CRITICAL RULE: report-job-verdict is the ONLY way a job is recorded and queued. If you open a
job and do NOT call report-job-verdict for it, that job is silently lost — all your reading was
wasted. You MUST call report-job-verdict exactly once for every job you open, before you move on
to the next card. Never open a job detail page without ending with a report-job-verdict call.

Process the cards STRICTLY ONE AT A TIME. Do not batch check-already-seen calls across many cards
and then move on — finish a card completely (check → open → judge → report) before touching the
next one.

=== HOW TO LIST JOBS RELIABLY (do this first) ===
Do NOT try to scrape the job cards off the normal JavaScript /jobs/search results page — it lazy-
loads, hides cards behind the auth-wall modal, and its DOM is unstable. Instead use LinkedIn's
public guest-jobs listing endpoint, which returns a clean, static HTML fragment of exactly 10 job
cards per request:

  https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<kw>&location=<loc>&f_TPR=<window>&sortBy=DD&start=<n>

Build that URL from the search results URL you were given: copy its "keywords", "location", and
"f_TPR" query params across verbatim (keep them URL-encoded), add "sortBy=DD" (freshest first) and
"start=0". If the given URL has a "geoId" param, carry that across instead of/along with location —
it is more precise. Navigate the browser to this guest URL (browser_goto), then read the returned
HTML (browser snapshot, or browser_evaluate returning document.body.innerHTML) and pull one entry
per <li> card:
  - jobId: the digits in  data-entity-urn="urn:li:jobPosting:(\\d+)"  (this is the authoritative id —
    prefer it over parsing the href).
  - title: text of  <h3 class="base-search-card__title"> ... </h3>
  - company: the <a> text inside  <h4 class="base-search-card__subtitle">
  - location: text of  <span class="job-search-card__location">
  - posted date: the datetime="YYYY-MM-DD" attribute of the card's <time> element (the class is
    either job-search-card__listdate or job-search-card__listdate--new — accept both).
  Collapse whitespace on every extracted string ( replace /\\s+/g with a single space, then trim ) —
  the raw HTML is heavily indented.
Pagination: page size is fixed at 10; there is no total-count field. To get more, refetch the same
guest URL with start=10, start=20, ... Stop when a fetch returns fewer than 10 cards or you have
enough. For a normal run, start=0 (the 10 freshest) is usually plenty.

=== THEN PROCESS EACH LISTED JOB, STRICTLY ONE AT A TIME ===
1. Pick the FIRST listed job you have not handled yet.
2. Call check-already-seen with its jobId BEFORE opening anything. If seen is true, skip it — move to
   the next job, no further action. (Do not call report-job-verdict for a seen job.)
3. If not seen, open its detail page in the SAME logged-in browser at
   https://www.linkedin.com/jobs/view/<jobId>/ . You must open it logged-in because the apply type
   is only visible when authenticated: read the full description and detect apply type — "easy" if
   there is an "Easy Apply" button, otherwise "external" (a plain "Apply" button that hands off to
   the company's own site).
4. Judge relevance against the resume, profile, and requirements above. Be reasonably selective —
   skip jobs that clearly mismatch seniority, location, or the stated requirements.
5. Call report-job-verdict with the jobId, title, company, location, sourceUrl (the search results
   URL you were given), applyUrl (the canonical detail URL https://www.linkedin.com/jobs/view/<jobId>/ —
   strip any ?position=...&trackingId=... tracking params), verdict ("relevant" or "skip"), applyType,
   and a short reason. Mandatory for EVERY opened job — a "skip" verdict still requires the call.
6. If report-job-verdict returns continue: false, stop immediately and finish your turn. Otherwise go
   back to step 1 for the next unhandled job.
7. If you hit a LinkedIn checkpoint, CAPTCHA, or any page that isn't the normal jobs UI, call
   request-human-input with a clear question describing what you're stuck on, then wait for the
   answer before continuing.

Notes / gotchas:
- The guest listing endpoint is anonymous and cheap; the per-job detail page must be the normal
  logged-in /jobs/view/<jobId>/ page so you can see the real apply button.
- If the guest endpoint ever returns an empty body or a non-jobs page, fall back to reading the job
  cards off the given /jobs/search URL directly, but still get each jobId from the
  urn:li:jobPosting:(\\d+) pattern in the card link.
- Never invent a jobId — if you cannot extract a numeric id for a card, skip that card.
- Be economical with page loads. There is an automatic, enforced pause after every navigation to
  stay under LinkedIn's automation limits — you do not need to add your own waits, but you SHOULD
  avoid redundant navigations: read everything you need from a page in one pass, don't re-open a
  page you already read, and don't reload the listing between jobs. Fewer, purposeful navigations
  keep the account safe.

Work through as many jobs as you can within these rules, then stop. Before you finish your turn,
double-check: did you call report-job-verdict once for every job you opened? If not, do it now.
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
    bailRatio: appState.settings.irrelevantBailRatio,
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
        requestHumanInput: createRequestHumanInputTool(),
      },
    })

    const triedUrls: string[] = []
    for (const url of urls) {
      ctx.bailRatio = appState.settings.irrelevantBailRatio
      if (abort.signal.aborted) break

      setAgentStatus(SEARCH_TAB, 'running', `scanning ${url}`)
      pushLog(SEARCH_TAB, `Scanning ${url}`)
      triedUrls.push(url)

      try {
        await agent.generate(`Search results URL to scan: ${url}`, {
          abortSignal: abort.signal,
          onStepFinish: (event) => logSearchStep(event, abort.signal),
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
