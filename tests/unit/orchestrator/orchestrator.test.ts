import { test, expect, vi } from 'vitest'
import { Orchestrator } from '../../../src/orchestrator/index.ts'

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

test('orchestrator starts and stops', async () => {
  const orch = new Orchestrator({ profileText: '', resumePath: '', config: { mustCheckUrls: [], requirements: '', cron: { recent: { intervalMinutes: 60 }, full: { intervalMinutes: 1440 } } } } as any)
  await orch.start('apply-only')
  expect(orch.isRunning).toBe(true)
  await orch.stop()
  expect(orch.isRunning).toBe(false)
})
