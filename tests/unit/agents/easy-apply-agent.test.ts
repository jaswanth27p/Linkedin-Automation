import { describe, test, expect, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs, applications } from '../../../src/db/schema.ts'
import { initAppState, appState } from '../../../src/state/app-state.ts'
import {
  processEasyApplyJob,
  createRecordAnswerTool,
  createReportSubmissionTool,
  type JobRecord,
  type SubmissionContext,
} from '../../../src/agents/easy-apply-agent.ts'

initAppState({ concurrency: 1, model: 'test', irrelevantBailRatio: 0.5, maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000 })

afterAll(async () => {
  await closeDb()
})

describe('processEasyApplyJob', () => {
  test('skips a job that is missing from the database', async () => {
    await processEasyApplyJob('does-not-exist')
    expect(appState.tabs.easy.logs.some((l) => l.includes('not found in database'))).toBe(true)
  })

  test('skips a job that has already been applied to', async () => {
    const db = getDb()
    await db
      .insert(jobs)
      .values({
        id: 'easy-agent-test-applied',
        title: 'Senior Engineer',
        company: 'Acme',
        applyUrl: 'https://linkedin.com/jobs/view/1',
        applyType: 'easy',
        sourceUrl: 'https://linkedin.com/jobs/search/?keywords=engineer',
        status: 'applied',
      })
      .onConflictDoNothing()

    await processEasyApplyJob('easy-agent-test-applied')
    expect(appState.tabs.easy.logs.some((l) => l.includes('already applied'))).toBe(true)

    await db.delete(jobs).where(eq(jobs.id, 'easy-agent-test-applied'))
  })
})

describe('answer tracking', () => {
  test('record-answer collects entries and report-submission persists them', async () => {
    const db = getDb()
    const job: JobRecord = {
      id: 'easy-agent-answers-test',
      title: 'Senior Engineer',
      company: 'Acme',
      applyUrl: 'https://linkedin.com/jobs/view/3',
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
    const recordAnswer = createRecordAnswerTool(ctx)
    await recordAnswer.execute!(
      { question: 'Years of experience?', answer: '2', source: 'profile' },
      {} as any,
    )
    await recordAnswer.execute!(
      { question: 'Why do you want this role?', answer: 'Great mission fit.', source: 'inferred' },
      {} as any,
    )

    const fakeBrowser = { screenshot: async () => ({ base64: '' }) } as any
    const reportSubmission = createReportSubmissionTool(job, fakeBrowser, ctx)
    await reportSubmission.execute!({ success: true }, {} as any)

    const rows = await db.select().from(applications).where(eq(applications.jobId, job.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.answers).toHaveLength(2)
    expect(rows[0]?.answers?.[0]).toEqual({ question: 'Years of experience?', answer: '2', source: 'profile' })

    await db.delete(applications).where(eq(applications.jobId, job.id))
    await db.delete(jobs).where(eq(jobs.id, job.id))
  })
})
