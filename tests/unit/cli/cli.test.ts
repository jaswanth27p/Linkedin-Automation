import { test, expect, vi } from 'vitest'

vi.mock('../../../src/config/loader.ts', () => ({
  loadConfig: vi.fn(() =>
    Promise.resolve({
      mustCheckUrls: ['https://linkedin.com/jobs'],
      requirements: 'TypeScript role',
      cron: {
        recent: { intervalMinutes: 60, postedWithinMinutes: 60 },
        full: { intervalMinutes: 1440 },
      },
      concurrency: 1,
      profileFiles: { profile: './profile.txt', resume: './resume.pdf' },
      model: 'opencode-go/kimi-k2.7-code',
    })
  ),
}))

vi.mock('../../../src/db/index.ts', () => ({
  getDb: vi.fn(() => ({})),
  closeDb: vi.fn(),
}))

vi.mock('../../../src/profile/loader.ts', () => ({
  loadProfileText: vi.fn(() => Promise.resolve('profile text')),
  buildProfileText: vi.fn(() => Promise.resolve('built profile text')),
}))

vi.mock('../../../src/profile/memory.ts', () => ({
  rememberFact: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../src/tui/index.tsx', () => ({
  startTui: vi.fn(),
}))

vi.mock('../../../src/utils/logger.ts', () => ({
  ensureDataDir: vi.fn(),
  ensureLogDirectory: vi.fn(),
  createLogger: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn() },
  logToTui: vi.fn(),
}))

vi.mock('../../../src/utils/app-events.ts', () => {
  const handlers: Record<string, Array<(value: unknown) => void>> = {}
  const state = { mode: 'idle', activeJob: null, prompt: null as string | null, promptJobId: null as string | null }
  return {
    appEvents: {
      on: vi.fn((event: string, cb: (value: unknown) => void) => {
        ;(handlers[event] ??= []).push(cb)
      }),
      emit: vi.fn((event: string, value: unknown) => {
        handlers[event]?.forEach((cb) => cb(value))
      }),
      getState: vi.fn(() => ({ ...state })),
      setState: vi.fn((patch: Record<string, unknown>) => {
        Object.assign(state, patch)
      }),
      subscribe: vi.fn(() => vi.fn()),
    },
  }
})

let lastOrchestratorInstance: any

vi.mock('../../../src/orchestrator/index.ts', () => {
  class FakeOrchestrator {
    isRunning = false
    on = vi.fn()
    start = vi.fn(() => Promise.resolve())
    stop = vi.fn(() => Promise.resolve())
    emit = vi.fn()
  }
  return {
    Orchestrator: vi.fn(function () {
      lastOrchestratorInstance = new FakeOrchestrator()
      return lastOrchestratorInstance
    }),
  }
})

test('cli has required entry exports', async () => {
  const cli = await import('../../../src/cli.ts')
  expect(typeof cli.main).toBe('function')
})

test('answer event remembers fact and resumes exact job', async () => {
  const { appEvents } = await import('../../../src/utils/app-events.ts')
  const { Orchestrator } = await import('../../../src/orchestrator/index.ts')
  const { rememberFact } = await import('../../../src/profile/memory.ts')

  // Trigger the answer handler registered by main()
  appEvents.setState({ prompt: 'salary expectation', promptJobId: 'job-1' })
  const answerHandlers = (appEvents.on as any).mock.calls.filter(([event]: [string]) => event === 'answer')
  expect(answerHandlers.length).toBeGreaterThan(0)
  await answerHandlers[0][1]('100000 USD')

  expect(appEvents.setState).toHaveBeenCalledWith({ prompt: null, promptJobId: null })
  expect(rememberFact).toHaveBeenCalledWith('salary expectation', '100000 USD')

  expect(lastOrchestratorInstance.emit).toHaveBeenCalledWith('resume', { answer: '100000 USD', jobId: 'job-1' })
})
