import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { JobRecord, SubmissionContext } from '../../../src/agents/easy-apply-agent.ts'
import { createReportSubmissionTool } from '../../../src/agents/easy-apply-agent.ts'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs, applications } from '../../../src/db/schema.ts'

// mock.module() is a global, process-wide override, not scoped to this file,
// and it is not automatically reset between test files (bun:test's
// mock.restore() does NOT undo mock.module() — verified empirically). This
// specifier is also mocked by prompt-channel-notify.test.ts. Registering it
// in beforeEach, immediately before each test, guarantees THIS file's mock is
// the one active when easy-apply-agent.ts's `notify(...)` call actually runs —
// easy-apply-agent.ts imports `notify` as a live named binding and calls it
// at runtime, so a mock registered this late (well after easy-apply-agent.ts
// and notify.ts have already been loaded/evaluated) still takes effect: per
// bun:test's own docs, mock.module() overwrites the exports of an
// already-loaded module in place.
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
  // Restore the real notify.ts so this mock doesn't leak into whichever file's
  // tests run next. The real module is fetched via a query-suffixed specifier,
  // which bypasses mock.module's interception and always resolves the genuine
  // module regardless of any mock currently registered for the plain specifier.
  //
  // The factory must return a plain object, NOT the ES module namespace
  // object `await import(...)` gives you — passing the namespace object
  // straight through made a subsequent mock.module() re-registration for the
  // same specifier silently stale by one call (verified empirically).
  // Spreading it into a fresh plain object literal fixes this.
  // Routed through a variable rather than a string literal so tsc's static
  // module resolution doesn't try to find a type declaration for the
  // Bun-runtime-only query-suffixed specifier.
  const notifySpecifier = '../../../src/notify/notify.ts?__restore_real_easy_apply_agent_notify'
  const real = await import(notifySpecifier)
  mock.module('../../../src/notify/notify.ts', () => ({ ...real }))

  await closeDb()
})

describe('easy-apply report-submission notifications', () => {
  test('notifies easy-apply-result on success', async () => {
    const db = getDb()
    const job: JobRecord = {
      id: 'easy-agent-notify-success',
      title: 'Senior Engineer',
      company: 'Acme',
      applyUrl: 'https://linkedin.com/jobs/view/9001',
    }
    await db.insert(jobs).values({
      id: job.id,
      title: job.title,
      company: job.company,
      applyUrl: job.applyUrl,
      applyType: 'easy',
      sourceUrl: 'https://linkedin.com/jobs/search/?keywords=engineer',
    }).onConflictDoNothing()

    const ctx: SubmissionContext = { reported: false, answers: [] }
    const fakeBrowser = { screenshot: async () => ({ base64: '' }) } as any
    const reportSubmission = createReportSubmissionTool(job, fakeBrowser, ctx)
    await reportSubmission.execute!({ success: true }, {} as any)

    expect(notifyCalls).toContainEqual({
      kind: 'easy-apply-result',
      success: true,
      title: 'Senior Engineer',
      company: 'Acme',
    })

    await db.delete(applications).where(eq(applications.jobId, job.id))
    await db.delete(jobs).where(eq(jobs.id, job.id))
  })

  test('notifies easy-apply-result with the error on failure', async () => {
    const db = getDb()
    const job: JobRecord = {
      id: 'easy-agent-notify-failure',
      title: 'Senior Engineer',
      company: 'Acme',
      applyUrl: 'https://linkedin.com/jobs/view/9002',
    }
    await db.insert(jobs).values({
      id: job.id,
      title: job.title,
      company: job.company,
      applyUrl: job.applyUrl,
      applyType: 'easy',
      sourceUrl: 'https://linkedin.com/jobs/search/?keywords=engineer',
    }).onConflictDoNothing()

    const ctx: SubmissionContext = { reported: false, answers: [] }
    const fakeBrowser = { screenshot: async () => ({ base64: '' }) } as any
    const reportSubmission = createReportSubmissionTool(job, fakeBrowser, ctx)
    await reportSubmission.execute!({ success: false, error: 'form crashed' }, {} as any)

    expect(notifyCalls).toContainEqual({
      kind: 'easy-apply-result',
      success: false,
      title: 'Senior Engineer',
      company: 'Acme',
      error: 'form crashed',
    })

    await db.delete(applications).where(eq(applications.jobId, job.id))
    await db.delete(jobs).where(eq(jobs.id, job.id))
  })
})
