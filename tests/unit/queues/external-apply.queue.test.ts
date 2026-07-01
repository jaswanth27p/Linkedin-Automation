import { test, expect, vi } from 'vitest'
import { Worker } from 'bullmq'
import { createExternalApplyWorker } from '../../../src/queues/external-apply.queue.ts'
import { redis } from '../../../src/queues/connection.ts'
import { runExternalApplyJob } from '../../../src/agents/external-apply-agent.ts'
import { deadLetterQueue } from '../../../src/queues/dead-letter.queue.ts'

const mockRunExternalApplyJob = vi.hoisted(() => vi.fn())
const mockWorker = vi.hoisted(() => ({ on: vi.fn(), close: vi.fn() }))
const mockDeadLetterAdd = vi.hoisted(() => vi.fn())

vi.mock('bullmq', () => ({
  Worker: vi.fn(function () { return mockWorker }),
}))

vi.mock('../../../src/queues/connection.ts', () => ({
  redis: { mockRedis: true },
}))

vi.mock('../../../src/agents/external-apply-agent.ts', () => ({
  runExternalApplyJob: mockRunExternalApplyJob,
}))

vi.mock('../../../src/queues/dead-letter.queue.ts', () => ({
  deadLetterQueue: { add: mockDeadLetterAdd },
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

test('Worker emits max-retried job to dead-letter queue', async () => {
  createExternalApplyWorker('profile text', '/tmp/resume.pdf')

  const failedHandler = mockWorker.on.mock.calls.find(([event]) => event === 'failed')?.[1] as
    | ((job: { name: string; id: string; data: typeof baseJob; attemptsMade: number; opts: { attempts?: number } }, err: Error) => void)
    | undefined

  expect(failedHandler).toBeDefined()

  const job = {
    name: 'external:1',
    id: 'external:1',
    data: baseJob,
    attemptsMade: 3,
    opts: { attempts: 3 },
  }
  failedHandler!(job, new Error('boom'))

  expect(mockDeadLetterAdd).toHaveBeenCalledTimes(1)
  expect(mockDeadLetterAdd).toHaveBeenCalledWith('external:1', baseJob, { jobId: 'external:1' })
})
