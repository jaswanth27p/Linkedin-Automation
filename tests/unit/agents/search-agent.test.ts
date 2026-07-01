import { test, expect, vi } from 'vitest'
import { runSearchJob } from '../../../src/agents/search-agent.ts'

vi.mock('../../../src/mastra/index.ts', () => ({
  createAgent: () => ({
    generate: vi.fn().mockResolvedValue({
      text: JSON.stringify([
        { id: '1', title: 'Backend', company: 'Acme', applyType: 'easy', applyUrl: 'https://linkedin.com/jobs/1' },
      ]),
    }),
  }),
  withBrowser: (fn: any) => fn(),
}))

vi.mock('../../../src/queues/search.queue.ts', () => ({
  enqueueJobs: vi.fn(),
}))

test('runSearchJob enqueues discovered jobs', async () => {
  const { enqueueJobs } = await import('../../../src/queues/search.queue.ts')
  await runSearchJob({ urls: ['https://linkedin.com/search'], profileText: 'Node', requirements: 'backend' })
  expect(enqueueJobs).toHaveBeenCalled()
})
