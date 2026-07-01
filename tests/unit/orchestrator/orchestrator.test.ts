import { test, expect, vi, beforeEach } from 'vitest'
import { Orchestrator } from '../../../src/orchestrator/index.ts'
import { searchQueue } from '../../../src/queues/search.queue.ts'
import { createEasyApplyWorker } from '../../../src/queues/easy-apply.queue.ts'
import { createExternalApplyWorker } from '../../../src/queues/external-apply.queue.ts'

vi.mock('../../../src/queues/connection.ts', () => ({
  redis: {},
}))
vi.mock('../../../src/agents/search-agent.ts', () => ({
  runSearchJob: vi.fn(),
}))
vi.mock('../../../src/queues/easy-apply.queue.ts', () => ({
  createEasyApplyWorker: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock('../../../src/queues/external-apply.queue.ts', () => ({
  createExternalApplyWorker: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock('../../../src/queues/search.queue.ts', () => ({
  searchQueue: { add: vi.fn(), removeRepeatableByKey: vi.fn() },
}))

const baseDeps = {
  profileText: 'profile',
  resumePath: '/resume.pdf',
  config: {
    mustCheckUrls: ['https://linkedin.com/jobs/search'],
    requirements: 'TypeScript backend role',
    cron: {
      recent: { intervalMinutes: 60, postedWithinMinutes: 60 },
      full: { intervalMinutes: 1440 },
    },
  },
} as any

beforeEach(() => {
  vi.clearAllMocks()
})

test('orchestrator starts and stops in apply-only mode', async () => {
  const orch = new Orchestrator(baseDeps)
  await orch.start('apply-only')
  expect(orch.isRunning).toBe(true)
  expect(searchQueue.add).not.toHaveBeenCalled()
  await orch.stop()
  expect(orch.isRunning).toBe(false)
})

test('recent-search mode enqueues a one-time recent-search job', async () => {
  const orch = new Orchestrator(baseDeps)
  await orch.start('recent-search')

  expect(searchQueue.add).toHaveBeenCalledTimes(1)
  expect(searchQueue.add).toHaveBeenCalledWith(
    'recent-search',
    expect.objectContaining({
      urls: baseDeps.config.mustCheckUrls,
      requirements: baseDeps.config.requirements,
      profileText: baseDeps.profileText,
      postedWithinMinutes: 60,
    })
  )
  expect(createEasyApplyWorker).toHaveBeenCalledWith(baseDeps.profileText, baseDeps.resumePath)
  expect(createExternalApplyWorker).toHaveBeenCalledWith(baseDeps.profileText, baseDeps.resumePath)

  await orch.stop()
})

test('full-search mode enqueues a one-time full-search job', async () => {
  const orch = new Orchestrator(baseDeps)
  await orch.start('full-search')

  expect(searchQueue.add).toHaveBeenCalledTimes(1)
  expect(searchQueue.add).toHaveBeenCalledWith(
    'full-search',
    expect.objectContaining({
      urls: baseDeps.config.mustCheckUrls,
      requirements: baseDeps.config.requirements,
      profileText: baseDeps.profileText,
    })
  )

  await orch.stop()
})

test('full-run mode schedules repeatable recent and full search jobs', async () => {
  const orch = new Orchestrator(baseDeps)
  await orch.start('full-run')

  expect(searchQueue.add).toHaveBeenCalledTimes(2)
  expect(searchQueue.add).toHaveBeenCalledWith(
    'recent-search',
    expect.objectContaining({ postedWithinMinutes: 60 }),
    { repeat: { key: 'recent-search', every: 60 * 60 * 1000 } }
  )
  expect(searchQueue.add).toHaveBeenCalledWith(
    'full-search',
    expect.objectContaining({ urls: baseDeps.config.mustCheckUrls }),
    { repeat: { key: 'full-search', every: 1440 * 60 * 1000 } }
  )

  await orch.stop()
  expect(searchQueue.removeRepeatableByKey).toHaveBeenCalledWith('recent-search')
  expect(searchQueue.removeRepeatableByKey).toHaveBeenCalledWith('full-search')
})
