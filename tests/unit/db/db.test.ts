import { test, expect } from 'vitest'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs } from '../../../src/db/schema.ts'

test('inserts and reads a job', async () => {
  const db = getDb('file::memory:')
  const [job] = await db.insert(jobs).values({
    id: 'job-1',
    title: 'Backend Engineer',
    company: 'Acme',
    applyUrl: 'https://linkedin.com/jobs/1',
    applyType: 'easy',
    sourceUrl: 'https://linkedin.com/search',
    status: 'discovered',
  }).returning()
  expect(job.title).toBe('Backend Engineer')
  closeDb()
})
