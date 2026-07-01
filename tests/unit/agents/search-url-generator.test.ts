import { test, expect, vi } from 'vitest'
import { generateSearchUrls } from '../../../src/agents/search-url-generator.ts'

vi.mock('../../../src/mastra/index.ts', () => ({
  createAgent: () => ({
    generate: vi.fn().mockResolvedValue({ text: '["https://www.linkedin.com/jobs/search/?keywords=backend"]' }),
  }),
}))

test('returns generated urls', async () => {
  const urls = await generateSearchUrls('remote backend', '# Profile\nNode')
  expect(urls.length).toBeGreaterThan(0)
  expect(urls[0]).toContain('linkedin.com')
})
