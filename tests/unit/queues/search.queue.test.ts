import { test, expect, vi } from 'vitest'
import { enqueueJobs } from '../../../src/queues/search.queue.ts'
import { createQueue } from '../../../src/queues/connection.ts'
import { getDb } from '../../../src/db/index.ts'
import { jobs } from '../../../src/db/schema.ts'

const mockOnConflictDoNothing = vi.fn()
const mockValues = vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing }))
const mockInsert = vi.fn(() => ({ values: mockValues }))

vi.mock('../../../src/queues/connection.ts', () => ({
  createQueue: vi.fn(() => ({ add: vi.fn(), remove: vi.fn() })),
}))

vi.mock('../../../src/db/index.ts', () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
  })),
}))

test('enqueueJobs inserts jobs into DB and routes them to correct queues', async () => {
  await enqueueJobs([
    { id: '1', title: 'Backend', company: 'Acme', applyUrl: 'https://linkedin.com/jobs/1', applyType: 'easy', sourceUrl: 'https://linkedin.com/search' },
    { id: '2', title: 'Frontend', company: 'Beta', applyUrl: 'https://example.com/jobs/2', applyType: 'external', sourceUrl: 'https://linkedin.com/search' },
  ])

  expect(getDb).toHaveBeenCalled()
  expect(mockInsert).toHaveBeenCalledTimes(2)
  expect(mockInsert).toHaveBeenCalledWith(jobs)
  expect(mockValues).toHaveBeenCalledWith(
    expect.objectContaining({ id: '1', applyType: 'easy', status: 'queued' }),
  )
  expect(mockValues).toHaveBeenCalledWith(
    expect.objectContaining({ id: '2', applyType: 'external', status: 'queued' }),
  )
  expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(2)

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
