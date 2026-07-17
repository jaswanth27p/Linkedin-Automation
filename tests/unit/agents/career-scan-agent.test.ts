import { describe, test, expect, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { applyUrlToJobId } from '../../../src/agents/career-scan-agent.ts'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs } from '../../../src/db/schema.ts'

afterAll(async () => {
  await closeDb()
})

describe('applyUrlToJobId', () => {
  test('is stable across calls for the same URL', () => {
    const url = 'https://boards.greenhouse.io/acme/jobs/12345'
    expect(applyUrlToJobId(url)).toBe(applyUrlToJobId(url))
  })

  test('differs for different URLs', () => {
    expect(applyUrlToJobId('https://acme.com/jobs/1')).not.toBe(applyUrlToJobId('https://acme.com/jobs/2'))
  })

  test('trims whitespace before hashing, so a re-judged posting still dedups', () => {
    expect(applyUrlToJobId('https://acme.com/jobs/1 ')).toBe(applyUrlToJobId('https://acme.com/jobs/1'))
  })
})

describe('career-page job dedup via onConflictDoNothing', () => {
  test('re-judging the same posting across two "runs" only inserts once', async () => {
    const db = getDb()
    const applyUrl = 'https://acme.com/jobs/dedup-test'
    const id = applyUrlToJobId(applyUrl)

    const insertRow = () =>
      db
        .insert(jobs)
        .values({
          id,
          title: 'Platform Engineer',
          company: 'Acme',
          applyUrl,
          applyType: 'external',
          sourceUrl: 'https://acme.com/careers',
          source: 'career_page',
          relevanceReason: 'stack match',
        })
        .onConflictDoNothing()
        .returning({ id: jobs.id })

    const first = await insertRow()
    expect(first).toHaveLength(1)

    // Simulate the agent re-judging the same posting relevant on a later /check-careers run.
    const second = await insertRow()
    expect(second).toHaveLength(0)

    const rows = await db.select().from(jobs).where(eq(jobs.id, id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.source).toBe('career_page')

    await db.delete(jobs).where(eq(jobs.id, id))
  })
})
