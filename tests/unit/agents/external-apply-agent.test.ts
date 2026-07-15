import { describe, test, expect, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs } from '../../../src/db/schema.ts'
import { initAppState, appState } from '../../../src/state/app-state.ts'
import { processExternalApplyJob } from '../../../src/agents/external-apply-agent.ts'

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
