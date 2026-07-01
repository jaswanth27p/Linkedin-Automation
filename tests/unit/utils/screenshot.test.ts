import { test, expect, vi, beforeEach } from 'vitest'
import { takeScreenshot } from '../../../src/utils/screenshot.ts'

const { screenshotMock, getBrowserPageMock, loggerErrorMock } = vi.hoisted(() => ({
  screenshotMock: vi.fn(),
  getBrowserPageMock: vi.fn(() => Promise.resolve({ screenshot: screenshotMock })),
  loggerErrorMock: vi.fn(),
}))

vi.mock('../../../src/mastra/index.ts', () => ({
  getBrowserPage: getBrowserPageMock,
}))

vi.mock('../../../src/utils/logger.ts', () => ({
  logger: { error: loggerErrorMock },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

test('takeScreenshot delegates to browser page', async () => {
  await takeScreenshot('/tmp/x.png')
  expect(getBrowserPageMock).toHaveBeenCalled()
  expect(screenshotMock).toHaveBeenCalledWith({ path: '/tmp/x.png' })
})

test('takeScreenshot logs and re-throws screenshot errors', async () => {
  const error = new Error('snap failed')
  screenshotMock.mockRejectedValueOnce(error)
  await expect(takeScreenshot('/tmp/x.png')).rejects.toThrow(error)
  expect(loggerErrorMock).toHaveBeenCalledWith({ err: error, path: '/tmp/x.png' }, 'screenshot failed')
})
