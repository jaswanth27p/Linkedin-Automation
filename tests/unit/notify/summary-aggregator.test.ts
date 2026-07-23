import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'
import {
  recordEasyApplyResult,
  recordExternalJobFound,
  flush,
  startSummaryScheduler,
  stopSummaryScheduler,
} from '../../../src/notify/summary-aggregator.ts'

// mock.module() is a global, process-wide override, not scoped to this file,
// and it is not automatically reset between test files (bun:test's
// mock.restore() does NOT undo mock.module() — verified empirically in the
// sibling notify-safety*/prompt-channel-notify/easy-apply-agent-notify test
// files). Registering it in beforeEach, immediately before each test,
// guarantees THIS file's mock is the one active when summary-aggregator.ts's
// `notify(...)` call actually runs.
const notifyCalls: unknown[] = []

beforeEach(() => {
  notifyCalls.length = 0
  mock.module('../../../src/notify/notify.ts', () => ({
    notify: (event: unknown) => {
      notifyCalls.push(event)
    },
  }))
})

afterAll(async () => {
  // Restore the real notify.ts so this mock doesn't leak into whichever
  // file's tests run next. Query-suffixed specifier bypasses mock.module's
  // interception; spread into a plain object, not the raw module namespace
  // (verified elsewhere in this suite: passing the namespace object directly
  // makes a later mock.module() re-registration silently stale by one call).
  const notifySpecifier = '../../../src/notify/notify.ts?__restore_real_summary_aggregator'
  const real = await import(notifySpecifier)
  mock.module('../../../src/notify/notify.ts', () => ({ ...real }))
})

describe('summary-aggregator', () => {
  test('flush does nothing when all counters are zero', () => {
    flush()
    expect(notifyCalls).toEqual([])
  })

  test('flush reports accumulated counts and resets them', () => {
    recordEasyApplyResult(true)
    recordEasyApplyResult(true)
    recordEasyApplyResult(false)
    recordExternalJobFound()
    recordExternalJobFound()
    recordExternalJobFound()

    flush()

    expect(notifyCalls).toEqual([
      { kind: 'summary', easyApplied: 2, easyFailed: 1, externalFound: 3, intervalMinutes: 30 },
    ])

    // Counters reset — a second immediate flush is a no-op.
    notifyCalls.length = 0
    flush()
    expect(notifyCalls).toEqual([])
  })

  test('flush reports a partial case (only external jobs found)', () => {
    recordExternalJobFound()

    flush()

    expect(notifyCalls).toEqual([
      { kind: 'summary', easyApplied: 0, easyFailed: 0, externalFound: 1, intervalMinutes: 30 },
    ])
  })

  test('startSummaryScheduler fires flush on the given interval, stopSummaryScheduler stops it', async () => {
    recordExternalJobFound()
    startSummaryScheduler(50)

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(notifyCalls.length).toBeGreaterThanOrEqual(1)

    stopSummaryScheduler()
    const countAfterStop = notifyCalls.length
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(notifyCalls.length).toBe(countAfterStop)
  })
})
