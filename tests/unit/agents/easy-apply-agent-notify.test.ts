import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { JobRecord, SubmissionContext } from '../../../src/agents/easy-apply-agent.ts'
import { createReportSubmissionTool } from '../../../src/agents/easy-apply-agent.ts'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs, applications } from '../../../src/db/schema.ts'

// mock.module() is a global, process-wide override, not scoped to this file,
// and it is not automatically reset between test files (bun:test's
// mock.restore() does NOT undo mock.module() — verified empirically
// elsewhere in this suite). Registering it in beforeEach, immediately before
// each test, guarantees THIS file's mock is the one active when
// easy-apply-agent.ts's `recordEasyApplyResult(...)` call actually runs.
const recordCalls: unknown[] = []

beforeEach(() => {
  recordCalls.length = 0
  mock.module('../../../src/notify/summary-aggregator.ts', () => ({
    recordEasyApplyResult: (success: boolean) => {
      recordCalls.push(success)
    },
  }))
})

afterAll(async () => {
  // Restore the real summary-aggregator.ts so this mock doesn't leak into
  // whichever file's tests run next. Query-suffixed specifier bypasses
  // mock.module's interception; spread into a plain object, not the raw
  // module namespace (verified elsewhere in this suite: passing the
  // namespace object directly makes a later mock.module() re-registration
  // silently stale by one call).
  const specifier = '../../../src/notify/summary-aggregator.ts?__restore_real_easy_apply_agent_notify'
  const real = await import(specifier)
  mock.module('../../../src/notify/summary-aggregator.ts', () => ({ ...real }))

  await closeDb()
})

describe('easy-apply report-submission notifications', () => {
  test('records a successful easy-apply result', async () => {
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

    expect(recordCalls).toEqual([true])

    await db.delete(applications).where(eq(applications.jobId, job.id))
    await db.delete(jobs).where(eq(jobs.id, job.id))
  })

  test('records a failed easy-apply result', async () => {
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

    expect(recordCalls).toEqual([false])

    await db.delete(applications).where(eq(applications.jobId, job.id))
    await db.delete(jobs).where(eq(jobs.id, job.id))
  })
})
