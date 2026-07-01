import { test, expect, vi } from 'vitest'
import { takeScreenshot } from '../../../src/utils/screenshot.ts'

const { screenshotMock, getPageMock } = vi.hoisted(() => ({
  screenshotMock: vi.fn(),
  getPageMock: vi.fn(() => ({ screenshot: screenshotMock })),
}))

vi.mock('../../../src/mastra/index.ts', () => ({
  browser: {
    getPage: getPageMock,
  },
}))

test('takeScreenshot delegates to browser page', async () => {
  await takeScreenshot('/tmp/x.png')
  expect(getPageMock).toHaveBeenCalled()
  expect(screenshotMock).toHaveBeenCalledWith({ path: '/tmp/x.png' })
})
