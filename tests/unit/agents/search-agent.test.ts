import { test, expect, vi, beforeEach } from 'vitest'
import { runSearchJob } from '../../../src/agents/search-agent.ts'

const mockAgent = vi.hoisted(() => ({ generate: vi.fn() }))
const mockGenerateSearchUrls = vi.hoisted(() => ({ generateSearchUrls: vi.fn() }))
const mockEnqueueJobs = vi.hoisted(() => ({ enqueueJobs: vi.fn() }))
const mockLogToTui = vi.hoisted(() => vi.fn())

vi.mock('../../../src/mastra/index.ts', () => ({
  createAgent: () => mockAgent,
  withBrowser: (fn: () => Promise<void>) => fn(),
}))

vi.mock('../../../src/agents/search-url-generator.ts', () => mockGenerateSearchUrls)

vi.mock('../../../src/queues/search.queue.ts', () => mockEnqueueJobs)

vi.mock('../../../src/utils/logger.ts', () => ({
  logToTui: mockLogToTui,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGenerateSearchUrls.generateSearchUrls.mockResolvedValue([])
  mockAgent.generate.mockResolvedValue({ text: JSON.stringify([]) })
})

const baseJob = {
  id: '1',
  title: 'Backend',
  company: 'Acme',
  applyType: 'easy',
  applyUrl: 'https://linkedin.com/jobs/1',
}

test('runSearchJob enqueues discovered jobs and overrides sourceUrl with the search URL', async () => {
  mockAgent.generate.mockResolvedValueOnce({
    text: JSON.stringify([{ ...baseJob, sourceUrl: 'https://agent-provided.com' }]),
  })

  await runSearchJob({ urls: ['https://linkedin.com/search'], profileText: 'Node', requirements: 'backend' })

  expect(mockEnqueueJobs.enqueueJobs).toHaveBeenCalledTimes(1)
  expect(mockEnqueueJobs.enqueueJobs).toHaveBeenCalledWith([
    expect.objectContaining({
      ...baseJob,
      sourceUrl: 'https://linkedin.com/search',
    }),
  ])
})

test('runSearchJob skips invalid job objects', async () => {
  mockAgent.generate.mockResolvedValueOnce({
    text: JSON.stringify([{ id: '1', company: 'Acme', applyType: 'easy', applyUrl: 'https://linkedin.com/jobs/1' }]),
  })

  await runSearchJob({ urls: ['https://linkedin.com/search'], profileText: 'Node', requirements: 'backend' })

  expect(mockEnqueueJobs.enqueueJobs).not.toHaveBeenCalled()
})

test('runSearchJob skips non-array agent responses', async () => {
  mockAgent.generate.mockResolvedValueOnce({ text: JSON.stringify({ jobs: [baseJob] }) })

  await runSearchJob({ urls: ['https://linkedin.com/search'], profileText: 'Node', requirements: 'backend' })

  expect(mockEnqueueJobs.enqueueJobs).not.toHaveBeenCalled()
})

test('runSearchJob skips jobs when JSON parse fails', async () => {
  mockAgent.generate.mockResolvedValueOnce({ text: 'not valid json' })

  await runSearchJob({ urls: ['https://linkedin.com/search'], profileText: 'Node', requirements: 'backend' })

  expect(mockEnqueueJobs.enqueueJobs).not.toHaveBeenCalled()
})

test('runSearchJob continues with remaining URLs when one URL throws', async () => {
  mockAgent.generate
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce({ text: JSON.stringify([{ ...baseJob, id: '2', applyType: 'external', applyUrl: 'https://example.com/jobs/2' }]) })

  await runSearchJob({
    urls: ['https://linkedin.com/search1', 'https://linkedin.com/search2'],
    profileText: 'Node',
    requirements: 'backend',
  })

  expect(mockEnqueueJobs.enqueueJobs).toHaveBeenCalledTimes(1)
  expect(mockEnqueueJobs.enqueueJobs).toHaveBeenCalledWith([
    expect.objectContaining({
      id: '2',
      applyType: 'external',
      sourceUrl: 'https://linkedin.com/search2',
    }),
  ])
})

test('runSearchJob throws when generateSearchUrls fails', async () => {
  mockGenerateSearchUrls.generateSearchUrls.mockRejectedValue(new Error('gen fail'))

  await expect(
    runSearchJob({ urls: ['https://linkedin.com/search'], profileText: 'Node', requirements: 'backend' }),
  ).rejects.toThrow('gen fail')
})
