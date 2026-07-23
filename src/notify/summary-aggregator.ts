import { notify } from './notify.ts'

let easyApplied = 0
let easyFailed = 0
let externalFound = 0
let intervalMinutes = 30
let timer: ReturnType<typeof setInterval> | null = null

export function recordEasyApplyResult(success: boolean): void {
  if (success) easyApplied++
  else easyFailed++
}

export function recordExternalJobFound(): void {
  externalFound++
}

/** Fires one combined OS notification for everything recorded since the last
 * flush, then resets all counters. Skips firing entirely when nothing was
 * recorded, so an idle period doesn't produce an empty toast. Exported
 * standalone (not only reachable through the scheduler) so tests can call it
 * directly without waiting on a real timer. */
export function flush(): void {
  if (easyApplied === 0 && easyFailed === 0 && externalFound === 0) return

  notify({ kind: 'summary', easyApplied, easyFailed, externalFound, intervalMinutes })

  easyApplied = 0
  easyFailed = 0
  externalFound = 0
}

export function startSummaryScheduler(intervalMs: number): void {
  intervalMinutes = Math.round(intervalMs / 60_000)
  timer = setInterval(flush, intervalMs)
}

export function stopSummaryScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
