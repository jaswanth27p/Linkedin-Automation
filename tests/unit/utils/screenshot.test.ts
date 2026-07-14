import { test, expect, mock, beforeEach } from 'bun:test'

const screenshotMock = mock(() => Promise.resolve())
const getBrowserPageMock = mock(() => Promise.resolve({ screenshot: screenshotMock }))
const loggerErrorMock = mock(() => {})

mock.module('../../../src/mastra/index.ts', () => ({
  getBrowserPage: getBrowserPageMock,
}))

mock.module('../../../src/utils/logger.ts', () => ({
  logger: { error: loggerErrorMock },
}))

beforeEach(() => {
  screenshotMock.mockClear()
  getBrowserPageMock.mockClear()
  loggerErrorMock.mockClear()
})

test('takeScreenshot delegates to browser page', async () => {
  const { takeScreenshot } = await import('../../../src/utils/screenshot.ts')
  await takeScreenshot('/tmp/x.png')
  expect(getBrowserPageMock).toHaveBeenCalled()
  expect(screenshotMock).toHaveBeenCalledWith({ path: '/tmp/x.png' })
})

test('takeScreenshot logs and re-throws screenshot errors', async () => {
  const { takeScreenshot } = await import('../../../src/utils/screenshot.ts')
  screenshotMock.mockImplementationOnce(() => Promise.reject(new Error('snap failed')))
  await expect(takeScreenshot('/tmp/x.png')).rejects.toThrow('snap failed')
  expect(loggerErrorMock).toHaveBeenCalled()
})
