import { test, expect, vi, beforeEach } from 'vitest'
import { Orchestrator } from '../../../src/orchestrator/index.ts'
import { searchQueue } from '../../../src/queues/search.queue.ts'
import { createEasyApplyWorker } from '../../../src/queues/easy-apply.queue.ts'
import { createExternalApplyWorker } from '../../../src/queues/external-apply.queue.ts'

const mockSelectChain = {
  from: vi.fn(() => mockSelectChain),
  leftJoin: vi.fn(() => mockSelectChain),
  where: vi.fn(() => mockSelectChain),
  orderBy: vi.fn(() => mockSelectChain),
  limit: vi.fn(() => mockSelectChain),
  get: vi.fn((): any => undefined),
}
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => mockSelectChain),
}))

vi.mock('../../../src/queues/connection.ts', () => ({
  redis: {},
}))
vi.mock('../../../src/db/index.ts', () => ({
  getDb: () => mockDb,
  closeDb: vi.fn(),
}))
vi.mock('../../../src/utils/logger.ts', () => ({
  logToTui: vi.fn(),
  createLogger: vi.fn(),
  ensureDataDir: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn() },
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
  easyApplyQueue: { add: vi.fn(), remove: vi.fn() },
  externalApplyQueue: { add: vi.fn(), remove: vi.fn() },
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
  mockSelectChain.get.mockReturnValue(undefined)
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

test('resume event removes and re-adds the most recent needs_input job', async () => {
  const { easyApplyQueue } = await import('../../../src/queues/search.queue.ts')
  mockSelectChain.get.mockReturnValue({
    jobs: {
      id: 'job-1',
      title: 'Backend',
      company: 'Acme',
      applyUrl: 'https://linkedin.com/jobs/1',
      applyType: 'easy',
      sourceUrl: 'https://linkedin.com/search',
    },
  })

  const orch = new Orchestrator(baseDeps)
  orch.emit('resume', 'yes')

  // Wait for async handler
  await new Promise((resolve) => setTimeout(resolve, 10))

  expect(easyApplyQueue.remove).toHaveBeenCalledWith('easy:job-1')
  expect(easyApplyQueue.add).toHaveBeenCalledWith(
    'easy:job-1',
    expect.objectContaining({ id: 'job-1', answer: 'yes' }),
    { jobId: 'easy:job-1' },
  )
})
