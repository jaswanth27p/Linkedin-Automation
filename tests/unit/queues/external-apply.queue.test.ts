import { test, expect, vi } from 'vitest'
import { Worker } from 'bullmq'
import { createExternalApplyWorker } from '../../../src/queues/external-apply.queue.ts'
import { redis } from '../../../src/queues/connection.ts'
import { runExternalApplyJob } from '../../../src/agents/external-apply-agent.ts'

const mockRunExternalApplyJob = vi.hoisted(() => vi.fn())

vi.mock('bullmq', () => ({
  Worker: vi.fn(),
}))

vi.mock('../../../src/queues/connection.ts', () => ({
  redis: { mockRedis: true },
}))

vi.mock('../../../src/agents/external-apply-agent.ts', () => ({
  runExternalApplyJob: mockRunExternalApplyJob,
}))

const baseJob = {
  id: '1',
  title: 'Backend Engineer',
  company: 'Acme',
  applyUrl: 'https://linkedin.com/jobs/1',
  applyType: 'external' as const,
  sourceUrl: 'https://linkedin.com/search',
}

test('createExternalApplyWorker configures Worker with cleanup options', () => {
  createExternalApplyWorker('profile text', '/tmp/resume.pdf')

  expect(Worker).toHaveBeenCalledTimes(1)
  expect(Worker).toHaveBeenCalledWith(
    'external-apply',
    expect.any(Function),
    {
      connection: redis,
      concurrency: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  )
})

test('Worker processor passes job answer to runExternalApplyJob', async () => {
  createExternalApplyWorker('profile text', '/tmp/resume.pdf')

  const processor = vi.mocked(Worker).mock.calls[0][1] as (job: { data: typeof baseJob & { answer?: string } }) => Promise<void>
  await processor({ data: { ...baseJob, answer: 'previous answer' } })

  expect(mockRunExternalApplyJob).toHaveBeenCalledTimes(1)
  expect(mockRunExternalApplyJob).toHaveBeenCalledWith(
    { ...baseJob, answer: 'previous answer' },
    'profile text',
    '/tmp/resume.pdf',
  )
})
