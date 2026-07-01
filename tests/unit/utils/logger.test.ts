import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createLogger, logToTui } from '../../../src/utils/logger.ts'

const mockSetState = vi.hoisted(() => vi.fn())
const mockGetState = vi.hoisted(() => vi.fn((): { logs: string[] } => ({ logs: [] })))

vi.mock('../../../src/utils/app-events.ts', () => ({
  appEvents: {
    setState: mockSetState,
    getState: mockGetState,
    subscribe: vi.fn(),
  },
}))

const LOG_FILE = './data/app.log'

beforeEach(() => {
  vi.clearAllMocks()
  try {
    fs.unlinkSync(LOG_FILE)
  } catch {
    // ignore
  }
})

afterEach(() => {
  try {
    fs.unlinkSync(LOG_FILE)
  } catch {
    // ignore
  }
})

test('logToTui appends message to logs state', () => {
  mockGetState.mockReturnValueOnce({ logs: ['ready'] as string[] })
  logToTui('hello')
  expect(mockSetState).toHaveBeenCalledWith({ logs: ['ready', 'hello'] })
})

test('createLogger writes formatted logs to file', async () => {
  const logger = createLogger()
  logger.info('logger test message')

  // Allow streams to flush.
  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(fs.existsSync(LOG_FILE)).toBe(true)
  const content = fs.readFileSync(LOG_FILE, 'utf-8')
  expect(content).toContain('logger test message')
})
