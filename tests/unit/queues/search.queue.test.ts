import { test, expect, vi } from 'vitest'
import { enqueueJobs } from '../../../src/queues/search.queue.ts'
import { createQueue } from '../../../src/queues/connection.ts'

vi.mock('../../../src/queues/connection.ts', () => ({
  createQueue: vi.fn(() => ({ add: vi.fn() })),
}))

test('enqueueJobs routes jobs to correct queues', async () => {
  await enqueueJobs([
    { id: '1', title: 'Backend', company: 'Acme', applyUrl: 'https://linkedin.com/jobs/1', applyType: 'easy', sourceUrl: 'https://linkedin.com/search' },
    { id: '2', title: 'Frontend', company: 'Beta', applyUrl: 'https://example.com/jobs/2', applyType: 'external', sourceUrl: 'https://linkedin.com/search' },
  ])

  const mockedCreateQueue = vi.mocked(createQueue)
  const easyAdd = mockedCreateQueue.mock.results[0].value.add
  const externalAdd = mockedCreateQueue.mock.results[1].value.add

  expect(easyAdd).toHaveBeenCalledTimes(1)
  expect(easyAdd).toHaveBeenCalledWith(
    'easy:1',
    expect.objectContaining({ id: '1', applyType: 'easy' }),
    { jobId: 'easy:1' },
  )

  expect(externalAdd).toHaveBeenCalledTimes(1)
  expect(externalAdd).toHaveBeenCalledWith(
    'external:2',
    expect.objectContaining({ id: '2', applyType: 'external' }),
    { jobId: 'external:2' },
  )
})
