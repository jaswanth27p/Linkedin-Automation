import { test, expect, vi } from 'vitest'
import { Worker } from 'bullmq'
import { createEasyApplyWorker } from '../../../src/queues/easy-apply.queue.ts'
import { redis } from '../../../src/queues/connection.ts'
import { runEasyApplyJob } from '../../../src/agents/easy-apply-agent.ts'

const mockRunEasyApplyJob = vi.hoisted(() => vi.fn())

vi.mock('bullmq', () => ({
  Worker: vi.fn(),
}))

vi.mock('../../../src/queues/connection.ts', () => ({
  redis: { mockRedis: true },
}))

vi.mock('../../../src/agents/easy-apply-agent.ts', () => ({
  runEasyApplyJob: mockRunEasyApplyJob,
}))

const baseJob = {
  id: '1',
  title: 'Backend Engineer',
  company: 'Acme',
  applyUrl: 'https://linkedin.com/jobs/1',
  applyType: 'easy' as const,
  sourceUrl: 'https://linkedin.com/search',
}

test('createEasyApplyWorker configures Worker with cleanup options', () => {
  createEasyApplyWorker('profile text', '/tmp/resume.pdf')

  expect(Worker).toHaveBeenCalledTimes(1)
  expect(Worker).toHaveBeenCalledWith(
    'easy-apply',
    expect.any(Function),
    {
      connection: redis,
      concurrency: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  )
})

test('Worker processor delegates to runEasyApplyJob', async () => {
  createEasyApplyWorker('profile text', '/tmp/resume.pdf')

  const processor = vi.mocked(Worker).mock.calls[0][1] as (job: { data: typeof baseJob }) => Promise<void>
  await processor({ data: baseJob })

  expect(mockRunEasyApplyJob).toHaveBeenCalledTimes(1)
  expect(mockRunEasyApplyJob).toHaveBeenCalledWith(baseJob, 'profile text', '/tmp/resume.pdf')
})
