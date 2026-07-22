import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'
import { waitForAnswer, answerPrompt } from '../../../src/state/prompt-channel.ts'

// mock.module() is a global, process-wide override, not scoped to this file,
// and it is not automatically reset between test files (bun:test's
// mock.restore() does NOT undo mock.module() — verified empirically). This
// specifier is also mocked by easy-apply-agent-notify.test.ts. Registering it
// in beforeEach, immediately before each test, guarantees THIS file's mock is
// the one active when prompt-channel.ts's `notify(...)` call actually runs —
// prompt-channel.ts imports `notify` as a live named binding and calls it at
// runtime, so a mock registered this late (well after prompt-channel.ts and
// notify.ts have already been loaded/evaluated) still takes effect: per
// bun:test's own docs, mock.module() overwrites the exports of an
// already-loaded module in place.
const calls: unknown[] = []

beforeEach(() => {
  calls.length = 0
  mock.module('../../../src/notify/notify.ts', () => ({
    notify: (event: unknown) => calls.push(event),
  }))
})

// Restore the real notify.ts so this mock doesn't leak into whichever file's
// tests run next. The real module is fetched via a query-suffixed specifier,
// which bypasses mock.module's interception and always resolves the genuine
// module regardless of any mock currently registered for the plain specifier.
//
// The factory must return a plain object, NOT the ES module namespace object
// `await import(...)` gives you — passing the namespace object straight
// through made a subsequent mock.module() re-registration for the same
// specifier silently stale by one call (verified empirically). Spreading it
// into a fresh plain object literal fixes this.
afterAll(async () => {
  // Routed through a variable rather than a string literal so tsc's static
  // module resolution doesn't try to find a type declaration for the
  // Bun-runtime-only query-suffixed specifier.
  const notifySpecifier = '../../../src/notify/notify.ts?__restore_real_prompt_channel_notify'
  const real = await import(notifySpecifier)
  mock.module('../../../src/notify/notify.ts', () => ({ ...real }))
})

describe('prompt-channel notifications', () => {
  test('waitForAnswer fires a needs-input notification', async () => {
    const promise = waitForAnswer('easy', 'Notice period?')
    answerPrompt('easy', '2 weeks')
    await promise

    expect(calls).toEqual([{ kind: 'needs-input', tab: 'easy', question: 'Notice period?' }])
  })
})
