import { getCurrentConfig } from '../config/current.ts'
import { pushLog } from '../state/app-state.ts'
import {
  runSearchUrls,
  generateSearchUrlsFromText,
  generateSearchUrlsFromResume,
  isSearchRunning,
  stopSearchAndWait,
} from './search-agent.ts'
import { startEasyApplyWorker } from '../queues/easy-apply-worker.ts'
import { startExternalApplyWorker } from '../queues/external-apply-worker.ts'
import { logger } from '../utils/logger.ts'
import type { TabId } from '../state/types.ts'
import type { AppConfig } from '../config/schema.ts'

const SEARCH_TAB: TabId = 'search'

export type AutoMode = 'loop' | 'interval'

const ROTATION_STEPS = ['urls', 'describe', 'resume'] as const
type RotationStep = (typeof ROTATION_STEPS)[number]

/** Parses a duration string into milliseconds. Accepts `<n>h`, `<n>m`, combined
 * `<n>h<n>m`, or a bare number (interpreted as hours). Returns null (not a throw) on
 * unparsable input or anything under the 1-minute floor, so callers can log a usage
 * message instead of surfacing a parse error. Exported for unit testing. */
export function parseDurationMs(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const hours = Number(trimmed)
    return hours > 0 ? hours * 3_600_000 : null
  }

  const match = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?$/i.exec(trimmed)
  if (!match || (!match[1] && !match[2])) return null

  const hours = match[1] ? Number(match[1]) : 0
  const minutes = match[2] ? Number(match[2]) : 0
  const ms = hours * 3_600_000 + minutes * 60_000
  return ms >= 60_000 ? ms : null
}

/** Human-readable duration for log lines, e.g. 5400000 -> "1h30m". Exported for testing. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0 && m > 0) return `${h}h${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

interface SchedulerState {
  mode: AutoMode | null
  intervalMs: number | null
  intervalHandle: ReturnType<typeof setInterval> | null
  loopActive: boolean
  tickRunning: boolean
  stepIndex: number
}

const state: SchedulerState = {
  mode: null,
  intervalMs: null,
  intervalHandle: null,
  loopActive: false,
  tickRunning: false,
  stepIndex: 0,
}

/** Tracks whatever single step/tick is currently in flight, regardless of mode, so
 * stopAutoModeAndWait can await it on shutdown without caring which mode was active. */
let activeWorkPromise: Promise<void> | null = null

export function isAutoModeOn(): boolean {
  return state.mode !== null
}

async function runStep(step: RotationStep, config: AppConfig): Promise<void> {
  if (isSearchRunning()) {
    pushLog(SEARCH_TAB, `Auto mode: skipping the ${step} step — a search is already running.`)
    return
  }

  try {
    if (step === 'urls') {
      if (config.mustCheckUrls.length === 0) {
        pushLog(SEARCH_TAB, 'Auto mode: no configured URLs to scan — skipping urls step.')
        return
      }
      await runSearchUrls(config, config.mustCheckUrls)
      return
    }

    if (step === 'describe') {
      const text = config.requirements.trim()
      if (!text) {
        pushLog(SEARCH_TAB, 'Auto mode: no requirements text configured — skipping describe step.')
        return
      }
      const urls = await generateSearchUrlsFromText(text)
      if (urls.length === 0) {
        pushLog(SEARCH_TAB, 'Auto mode: could not generate search URLs from requirements — skipping describe step.')
        return
      }
      await runSearchUrls(config, urls)
      return
    }

    // step === 'resume'
    const urls = await generateSearchUrlsFromResume(config)
    if (urls.length === 0) {
      pushLog(SEARCH_TAB, 'Auto mode: could not generate search URLs from resume.md — skipping resume step.')
      return
    }
    await runSearchUrls(config, urls)
  } catch (err) {
    pushLog(SEARCH_TAB, `Auto mode: ${step} step failed: ${err instanceof Error ? err.message : String(err)}`)
    logger.error({ err, step }, 'auto mode: step failed')
  }
}

async function runLoop(): Promise<void> {
  while (state.mode === 'loop' && state.loopActive) {
    const step = ROTATION_STEPS[state.stepIndex % ROTATION_STEPS.length]!
    const work = runStep(step, getCurrentConfig())
    activeWorkPromise = work
    await work
    state.stepIndex++
  }
}

async function runIntervalTick(): Promise<void> {
  if (state.tickRunning) {
    pushLog(SEARCH_TAB, 'Auto mode: previous interval cycle is still running — skipping this tick.')
    return
  }
  state.tickRunning = true
  const work = (async () => {
    try {
      const config = getCurrentConfig()
      for (const step of ROTATION_STEPS) {
        if (state.mode !== 'interval') break
        await runStep(step, config)
      }
      if (state.mode === 'interval' && state.intervalMs !== null) {
        pushLog(SEARCH_TAB, `Auto mode: cycle finished — next tick in ~${formatDuration(state.intervalMs)}.`)
      }
    } finally {
      state.tickRunning = false
    }
  })()
  activeWorkPromise = work
  await work
}

/** Starts both apply-queue workers if they aren't already running — both are
 * idempotent no-ops when already started, so this is safe to call unconditionally. */
function ensureApplyWorkersRunning(): void {
  startEasyApplyWorker()
  startExternalApplyWorker()
}

export function startAutoMode(mode: AutoMode, intervalMs?: number): void {
  if (state.mode !== null) {
    pushLog(SEARCH_TAB, `Auto mode is already on (${state.mode}). Use /auto-off first.`)
    return
  }

  ensureApplyWorkersRunning()

  if (mode === 'loop') {
    state.mode = 'loop'
    state.loopActive = true
    state.stepIndex = 0
    pushLog(SEARCH_TAB, 'Auto mode: loop started (urls → describe → resume, continuous).')
    void runLoop()
    return
  }

  // mode === 'interval'
  if (!intervalMs) throw new Error('intervalMs is required for interval mode')
  state.mode = 'interval'
  state.intervalMs = intervalMs
  pushLog(SEARCH_TAB, `Auto mode: interval started, every ${formatDuration(intervalMs)}.`)
  state.intervalHandle = setInterval(() => {
    void runIntervalTick()
  }, intervalMs)
  void runIntervalTick()
}

export function stopAutoMode(): void {
  if (state.mode === null) {
    pushLog(SEARCH_TAB, 'Auto mode is not on.')
    return
  }
  pushLog(SEARCH_TAB, 'Auto mode: stopping (any in-flight step will finish on its own).')
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle)
    state.intervalHandle = null
  }
  state.loopActive = false
  state.mode = null
  state.intervalMs = null
}

/** Silent variant for app shutdown — no user-facing log, just tears the scheduler down. */
function stopAutoModeSilently(): void {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle)
    state.intervalHandle = null
  }
  state.loopActive = false
  state.mode = null
  state.intervalMs = null
}

/** For app shutdown. Order matters here: stop scheduling FIRST (so the loop/interval
 * driver never starts another step once the current one ends), then abort+wait for
 * whatever runSearchUrls call is actually in flight via search-agent's own
 * stopSearchAndWait (shared AbortController — covers both manually-triggered and
 * scheduler-triggered runs), and only then await activeWorkPromise as a final catch-all
 * for the non-abortable URL-generation call (generateSearchUrlsFromText/FromResume use a
 * separate small Agent with no AbortSignal) a describe/resume step might currently be
 * in the middle of. Awaiting activeWorkPromise BEFORE aborting the search would risk
 * hanging shutdown indefinitely on a long-running scan. */
export async function stopAutoModeAndWait(): Promise<void> {
  stopAutoModeSilently()
  await stopSearchAndWait()
  if (activeWorkPromise) {
    await activeWorkPromise.catch(() => {})
  }
}
