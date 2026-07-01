import { test, expect, beforeEach } from 'vitest'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { rememberFact, getFactsText } from '../../../src/profile/memory.ts'
import { loadProfileText, buildProfileText } from '../../../src/profile/loader.ts'
import { writeFileSync, unlinkSync } from 'node:fs'

beforeEach(() => {
  closeDb()
})

test('remembers and recalls facts', async () => {
  getDb(':memory:')
  await rememberFact('notice period', '30 days')
  const text = await getFactsText()
  expect(text).toContain('notice period')
  expect(text).toContain('30 days')
})

test('loads markdown profile', async () => {
  writeFileSync('/tmp/profile.md', '# Profile\nName: Jane')
  const text = await loadProfileText('/tmp/profile.md')
  expect(text).toContain('Jane')
  unlinkSync('/tmp/profile.md')
})

test('buildProfileText combines profile, learned answers, and resume path', async () => {
  getDb(':memory:')
  writeFileSync('/tmp/profile.md', '# Profile\nName: Jane')
  await rememberFact('notice period', '30 days')

  const text = await buildProfileText({
    profileFiles: { profile: '/tmp/profile.md', resume: '/tmp/resume.pdf' },
  } as any)

  expect(text).toContain('Jane')
  expect(text).toContain('Learned answers:')
  expect(text).toContain('notice period')
  expect(text).toContain('30 days')
  expect(text).toContain('Resume path:')
  expect(text).toContain('/tmp/resume.pdf')

  unlinkSync('/tmp/profile.md')
})
