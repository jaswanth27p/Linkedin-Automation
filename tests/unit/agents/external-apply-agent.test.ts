import { test, expect, vi, beforeEach } from 'vitest'
import { runExternalApplyJob } from '../../../src/agents/external-apply-agent.ts'
import { NeedsInputError } from '../../../src/errors/needs-input-error.ts'

const mockAgent = vi.hoisted(() => ({ generate: vi.fn() }))
const mockTakeScreenshot = vi.hoisted(() => vi.fn())

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
