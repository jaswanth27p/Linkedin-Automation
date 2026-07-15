import { describe, test, expect, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs } from '../../../src/db/schema.ts'
import { initAppState, appState } from '../../../src/state/app-state.ts'
import { processEasyApplyJob } from '../../../src/agents/easy-apply-agent.ts'

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
