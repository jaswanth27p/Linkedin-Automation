import { describe, test, expect, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs } from '../../../src/db/schema.ts'

describe('db schema', () => {
  afterAll(async () => {
    await closeDb()
  })

  test('inserts and reads back a job row', async () => {
    const db = getDb()
    await db.insert(jobs).values({
      id: 'test-job-1',
      title: 'Senior Engineer',
      company: 'Acme',
      applyUrl: 'https://linkedin.com/jobs/view/1',
      applyType: 'easy',
      sourceUrl: 'https://linkedin.com/jobs/search/?keywords=engineer',
    }).onConflictDoNothing()

    const rows = await db.select().from(jobs).where(eq(jobs.id, 'test-job-1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('discovered')

    await db.delete(jobs).where(eq(jobs.id, 'test-job-1'))
  })
})
