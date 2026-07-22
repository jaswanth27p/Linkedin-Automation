import { describe, test, expect, mock, beforeEach, beforeAll, afterAll } from 'bun:test'
import { notify } from '../../../src/notify/notify.ts'

// mock.module() replaces a module specifier's resolution GLOBALLY and
// PERSISTENTLY for the whole bun:test process, not just for this file, and
// bun:test's mock.restore() does NOT undo mock.module() (verified: it only
// resets jest-style mock() spies). notify-safety-click.test.ts registers a
// conflicting 'node-notifier' mock, and since collection/execution order
// across the full suite is not guaranteed, a top-level mock.module() call
// here can be clobbered by that file's registration before this file's tests
// actually run. Fix: (re-)register the mock in beforeEach, immediately
// before each test runs, so the correct mock is guaranteed active at call
// time — notify() reads `notifier.notify`/`notifier.once` live at call time
// (not a captured reference), so a mock registered this late still takes
// effect even though notify.ts/node-notifier may already have been loaded by
// another file.
//
// Separately: prompt-channel-notify.test.ts and easy-apply-agent-notify.test.ts
// both call mock.module('../../../src/notify/notify.ts', ...), replacing the
// EXPORTED `notify` function itself. Since this file imports that same
// `notify` name as a live ESM binding, whichever of those two files' mock is
// active at the moment THIS file's test body runs would otherwise hijack the
// call entirely (verified empirically — this is what caused the click test
// to see an undefined capturedClickCallback: it was calling their fake
// array-push function, never touching node-notifier at all). So this file's
// beforeEach must ALSO defensively restore notify.ts's export to the real
// implementation before every test.
//
// IMPORTANT: the factory must return a plain object, NOT the ES module
// namespace object `await import(...)` gives you. Passing the namespace
// object straight through to mock.module() made re-registration silently
// stale by one call (verified empirically — a subsequent mock.module() call
// for the same specifier would still observe the PREVIOUS mock's value, one
// call behind). Spreading it into a fresh plain object literal fixes this.
// The query suffix is a Bun-runtime-only module-resolution feature (bypasses
// mock.module's interception); routed through a variable rather than a
// string literal so tsc's static module resolution doesn't try to find a
// type declaration for it.
let realNotifyModule: Record<string, unknown>
beforeAll(async () => {
  const notifySpecifier = '../../../src/notify/notify.ts?__real_for_notify_safety'
  const real = await import(notifySpecifier)
  realNotifyModule = { ...real }
})

beforeEach(() => {
  mock.module('../../../src/notify/notify.ts', () => realNotifyModule)

  mock.module('node-notifier', () => ({
    default: {
      notify: () => {
        throw new Error('no notification daemon on this machine')
      },
      once: () => {},
    },
  }))

  mock.module('open', () => ({
    default: async () => {
      throw new Error('no default browser configured')
    },
  }))
})

// Explicitly restore both specifiers to their real implementations once this
// file's tests are done, so the mock doesn't leak into whichever file's
// tests run next. A bare `mock.module(id, () => real)` re-registration is
// the only mechanism that actually works here (mock.restore() does not); the
// real modules are fetched via a query-suffixed specifier, which bypasses
// mock.module's interception and always resolves the genuine module
// regardless of any mock currently registered for the plain specifier.
afterAll(async () => {
  const notifierSpecifier = 'node-notifier?__restore_real_notify_safety'
  const realNotifier = await import(notifierSpecifier)
  mock.module('node-notifier', () => ({ ...realNotifier }))

  const openSpecifier = 'open?__restore_real_notify_safety'
  const realOpen = await import(openSpecifier)
  mock.module('open', () => ({ ...realOpen }))
})

describe('notify', () => {
  test('never throws even when node-notifier itself throws', () => {
    expect(() => notify({ kind: 'needs-input', tab: 'search', question: 'q' })).not.toThrow()
  })

  test('never throws for an external-job-found event either', () => {
    expect(() =>
      notify({ kind: 'external-job-found', title: 'Engineer', company: 'Acme', applyUrl: 'https://acme.com/jobs/1' }),
    ).not.toThrow()
  })
})
