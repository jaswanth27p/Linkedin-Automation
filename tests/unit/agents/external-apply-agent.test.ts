import { test, expect, vi, beforeEach } from 'vitest'
import { runExternalApplyJob } from '../../../src/agents/external-apply-agent.ts'
import { NeedsInputError } from '../../../src/errors/needs-input-error.ts'

const mockAgent = vi.hoisted(() => ({ generate: vi.fn() }))
const mockTakeScreenshot = vi.hoisted(() => vi.fn())
const mockLogToTui = vi.hoisted(() => vi.fn())
const mockSetState = vi.hoisted(() => vi.fn())

vi.mock('../../../src/mastra/index.ts', () => ({
  createAgent: () => mockAgent,
  withBrowser: (fn: () => Promise<void>) => fn(),
}))

vi.mock('../../../src/db/index.ts', () => ({
  getDb: () => ({
    insert: () => ({ values: vi.fn() }),
    update: () => ({ set: () => ({ where: vi.fn() }) }),
  }),
}))

vi.mock('../../../src/utils/screenshot.ts', () => ({
  takeScreenshot: mockTakeScreenshot,
}))

vi.mock('../../../src/utils/logger.ts', () => ({
  logToTui: mockLogToTui,
}))

vi.mock('../../../src/utils/app-events.ts', () => ({
  appEvents: { setState: mockSetState, getState: vi.fn(() => ({})) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockAgent.generate.mockRejectedValue(new Error('NEEDS_INPUT: salary expectation'))
  mockTakeScreenshot.mockResolvedValue(undefined)
})

test('runExternalApplyJob throws NeedsInputError', async () => {
  await expect(runExternalApplyJob({
    id: '1', title: 'BE', company: 'Acme', applyUrl: 'https://example.com/apply',
    applyType: 'external', sourceUrl: 'https://linkedin.com/search',
  }, 'profile', '/resume.pdf')).rejects.toBeInstanceOf(NeedsInputError)
})

test('runExternalApplyJob sets TUI prompt on needs_input', async () => {
  await expect(runExternalApplyJob({
    id: '1', title: 'BE', company: 'Acme', applyUrl: 'https://example.com/apply',
    applyType: 'external', sourceUrl: 'https://linkedin.com/search',
  }, 'profile', '/resume.pdf')).rejects.toBeInstanceOf(NeedsInputError)

  expect(mockSetState).toHaveBeenCalledWith({ prompt: 'salary expectation', promptJobId: '1' })
})

test('runExternalApplyJob includes previous answer in prompt when provided', async () => {
  mockAgent.generate.mockRejectedValueOnce(new Error('form error'))

  await expect(runExternalApplyJob({
    id: '1', title: 'BE', company: 'Acme', applyUrl: 'https://example.com/apply',
    applyType: 'external', sourceUrl: 'https://linkedin.com/search',
    answer: '100000 USD',
  }, 'profile', '/resume.pdf')).rejects.toThrow('form error')

  expect(mockAgent.generate).toHaveBeenCalledWith(
    expect.stringContaining('The user previously answered the following question: 100000 USD'),
    expect.anything(),
  )
})

test('runExternalApplyJob still throws original error when screenshot fails', async () => {
  mockAgent.generate.mockRejectedValueOnce(new Error('form error'))
  mockTakeScreenshot.mockRejectedValueOnce(new Error('screenshot failed'))

  await expect(runExternalApplyJob({
    id: '1', title: 'BE', company: 'Acme', applyUrl: 'https://example.com/apply',
    applyType: 'external', sourceUrl: 'https://linkedin.com/search',
  }, 'profile', '/resume.pdf')).rejects.toThrow('form error')

  expect(mockLogToTui).toHaveBeenCalledWith(expect.stringContaining('screenshot failed'))
})
