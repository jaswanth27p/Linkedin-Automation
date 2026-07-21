import { describe, test, expect, mock, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { JobRecord, SubmissionContext } from '../../../src/agents/easy-apply-agent.ts'

const notifyCalls: unknown[] = []
mock.module('../../../src/notify/notify.ts', () => ({
  notify: (event: unknown) => {
    notifyCalls.push(event)
  },
}))

// Dynamic import (not a static import) for the runtime value: the mock.module
// call above must run before easy-apply-agent.ts's own top-level `import {
// notify }` is evaluated, otherwise it binds the real notify implementation.
const { createReportSubmissionTool } = await import('../../../src/agents/easy-apply-agent.ts')
const { getDb, closeDb } = await import('../../../src/db/index.ts')
const { jobs, applications } = await import('../../../src/db/schema.ts')

afterAll(async () => {
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
