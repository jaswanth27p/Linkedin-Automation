import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { writeFile, rm } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { answerReviews } from '../../../src/db/schema.ts'
import { setCurrentConfig } from '../../../src/config/current.ts'
import { loadConfig } from '../../../src/config/loader.ts'
import { handleRequest } from '../../../src/dashboard/server.ts'

const TEST_PROFILE_PATH = './data/test-profile-dashboard.json'

beforeAll(async () => {
  await writeFile(
    TEST_PROFILE_PATH,
    JSON.stringify({
      contact: { email: 'a@b.com', phone: '', location: '' },
      workAuth: { authorized: true, requiresSponsorship: false },
      experienceYears: 2,
      salaryExpectation: { min: 0, max: 0, currency: 'USD' },
      links: { linkedin: '', github: '', portfolio: '' },
      answers: {},
    }, null, 2),
  )
  const baseConfig = await loadConfig('./linkedin-auto.config.ts')
  setCurrentConfig({ ...baseConfig, profileFiles: { ...baseConfig.profileFiles, profile: TEST_PROFILE_PATH } })
})

afterAll(async () => {
  await rm(TEST_PROFILE_PATH, { force: true })
  await closeDb()
})

describe('dashboard handleRequest', () => {
  test('GET / renders the summary page', async () => {
    const res = await handleRequest(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Today')
  })

  test('GET /applications renders the applications list', async () => {
    const res = await handleRequest(new Request('http://localhost/applications'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Applications')
  })

  test('GET /review renders the grouped review page', async () => {
    const res = await handleRequest(new Request('http://localhost/review'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Review')
  })

  test('GET /external-jobs renders the external jobs list', async () => {
    const res = await handleRequest(new Request('http://localhost/external-jobs'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('External Jobs')
  })

  test('unknown route returns 404', async () => {
    const res = await handleRequest(new Request('http://localhost/nope'))
    expect(res.status).toBe(404)
  })

  test('POST /review/feedback with a wrong verdict writes back to profile.json.answers and logs a review', async () => {
    const form = new URLSearchParams()
    form.set('question', 'Are you willing to relocate?')
    form.set('answer', 'Maybe')
    form.set('verdict', 'wrong')
    form.set('note', 'No')

    const res = await handleRequest(
      new Request('http://localhost/review/feedback', {
        method: 'POST',
        body: form,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )
    expect(res.status).toBe(303)

    const db = getDb()
    const rows = await db.select().from(answerReviews).where(eq(answerReviews.question, 'Are you willing to relocate?'))
    expect(rows.length).toBeGreaterThan(0)

    const saved = JSON.parse(await Bun.file(TEST_PROFILE_PATH).text())
    expect(saved.answers['Are you willing to relocate?']).toBe('No')

    await db.delete(answerReviews).where(eq(answerReviews.question, 'Are you willing to relocate?'))
  })
})
