import { test, expect } from 'vitest'
import { loadConfig } from '../../../src/config/loader.ts'

test('loads and validates sample config', async () => {
  const config = await loadConfig('./linkedin-auto.config.ts')
  expect(config.mustCheckUrls).toHaveLength(1)
  expect(config.requirements).toContain('remote')
})
