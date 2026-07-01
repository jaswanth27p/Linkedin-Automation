import { test, expect, beforeEach } from 'vitest'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { rememberFact, getFactsText } from '../../../src/profile/memory.ts'
import { loadProfileText } from '../../../src/profile/loader.ts'
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
