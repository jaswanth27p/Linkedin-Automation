import { describe, test, expect, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs, applications } from '../../../src/db/schema.ts'
import { initAppState, appState } from '../../../src/state/app-state.ts'
import {
  processExternalApplyJob,
  createRecordAnswerTool,
  createReportSubmissionTool,
  type JobRecord,
  type SubmissionContext,
} from '../../../src/agents/external-apply-agent.ts'

initAppState({ concurrency: 1, model: 'test', irrelevantBailRatio: 0.5, maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000 })

afterAll(async () => {
  await closeDb()
})

describe('processExternalApplyJob', () => {
  test('skips a job that is missing from the database', async () => {
    await processExternalApplyJob('does-not-exist-external')
    expect(appState.tabs.external.logs.some((l) => l.includes('not found in database'))).toBe(true)
  })

  test('skips a job that has already been applied to', async () => {
    const db = getDb()
    await db
      .insert(jobs)
      .values({
        id: 'external-agent-test-applied',
        title: 'Senior Engineer',
        company: 'Acme',
        applyUrl: 'https://boards.greenhouse.io/acme/jobs/1',
        applyType: 'external',
        sourceUrl: 'https://linkedin.com/jobs/search/?keywords=engineer',
        status: 'applied',
      })
      .onConflictDoNothing()

    await processExternalApplyJob('external-agent-test-applied')
    expect(appState.tabs.external.logs.some((l) => l.includes('already applied'))).toBe(true)

    await db.delete(jobs).where(eq(jobs.id, 'external-agent-test-applied'))
  })
})

describe('answer tracking', () => {
  test('record-answer collects entries and report-submission persists them', async () => {
    const db = getDb()
    const job: JobRecord = {
      id: 'external-agent-answers-test',
      title: 'Senior Engineer',
      company: 'Acme',
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/2',
    }
    await db.insert(jobs).values({
      id: job.id,
      title: job.title,
      company: job.company,
      applyUrl: job.applyUrl,
      applyType: 'external',
      sourceUrl: 'https://linkedin.com/jobs/search/?keywords=engineer',
    }).onConflictDoNothing()

    const ctx: SubmissionContext = { reported: false, answers: [] }
    const recordAnswer = createRecordAnswerTool(ctx)
    await recordAnswer.execute!(
      { question: 'Do you require sponsorship?', answer: 'No', source: 'profile' },
      {} as any,
    )

    const fakeBrowser = { screenshot: async () => ({ base64: '' }) } as any
    const reportSubmission = createReportSubmissionTool(job, fakeBrowser, ctx)
    await reportSubmission.execute!({ success: false, error: 'site crashed mid-form' }, {} as any)

    const rows = await db.select().from(applications).where(eq(applications.jobId, job.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.answers).toEqual([{ question: 'Do you require sponsorship?', answer: 'No', source: 'profile' }])

    await db.delete(applications).where(eq(applications.jobId, job.id))
    await db.delete(jobs).where(eq(jobs.id, job.id))
  })
})
