import { test, expect } from 'vitest'
import { getBrowserLock } from '../../../src/utils/mutex.ts'

test('mutex serializes access', async () => {
  const lock = getBrowserLock()
  let counter = 0
  await Promise.all([
    lock.run(async () => { counter++ }),
    lock.run(async () => { counter++ }),
  ])
  expect(counter).toBe(2)
})
