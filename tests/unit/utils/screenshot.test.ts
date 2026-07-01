import { test, expect, vi } from 'vitest'
import { takeScreenshot } from '../../../src/utils/screenshot.ts'

vi.mock('../../../src/mastra/index.ts', () => ({
  browser: {
    getPage: vi.fn(() => ({ screenshot: vi.fn() })),
  },
}))

test('takeScreenshot delegates to browser page', async () => {
  const { browser } = await import('../../../src/mastra/index.ts')
  await takeScreenshot('/tmp/x.png')
  expect((browser as any).getPage).toHaveBeenCalled()
})
