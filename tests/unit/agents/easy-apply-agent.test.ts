import { test, expect, vi, beforeEach, type Mock } from 'vitest'
import { runEasyApplyJob } from '../../../src/agents/easy-apply-agent.ts'
import { applications, jobs } from '../../../src/db/schema.ts'

const valuesMocks: Mock[] = []
const setMocks: Mock[] = []

const mockAgent = vi.hoisted(() => ({ generate: vi.fn() }))
const mockDb = vi.hoisted(() => ({
  insert: vi.fn(() => {
    const values = vi.fn()
    valuesMocks.push(values)
    return { values }
  }),
  update: vi.fn(() => {
    const set = vi.fn(() => ({ where: vi.fn() }))
    setMocks.push(set)
    return { set }
  }),
}))
const mockTakeScreenshot = vi.hoisted(() => vi.fn())
const mockLogToTui = vi.hoisted(() => vi.fn())

vi.mock('../../../src/mastra/index.ts', () => ({
  createAgent: () => mockAgent,
  withBrowser: (fn: () => Promise<void>) => fn(),
}))

vi.mock('../../../src/db/index.ts', () => ({
  getDb: () => mockDb,
}))

vi.mock('../../../src/utils/screenshot.ts', () => ({
  takeScreenshot: mockTakeScreenshot,
}))

vi.mock('../../../src/utils/logger.ts', () => ({
  logToTui: mockLogToTui,
}))

beforeEach(() => {
  vi.clearAllMocks()
  valuesMocks.length = 0
  setMocks.length = 0
  mockAgent.generate.mockResolvedValue({ text: 'submitted' })
})

const baseJob = {
  id: '1',
  title: 'Backend Engineer',
  company: 'Acme',
  applyUrl: 'https://linkedin.com/jobs/1',
  applyType: 'easy' as const,
  sourceUrl: 'https://linkedin.com/search',
}

test('runEasyApplyJob calls agent generate and records applied status', async () => {
  await runEasyApplyJob(baseJob, 'profile text', '/tmp/resume.pdf')

  expect(mockAgent.generate).toHaveBeenCalledTimes(1)
  expect(mockAgent.generate).toHaveBeenCalledWith(
    expect.stringContaining(baseJob.applyUrl),
    { memory: { resource: 'user', thread: 'easy-apply-agent' } },
  )

  expect(mockDb.insert).toHaveBeenCalledTimes(1)
  expect(mockDb.insert).toHaveBeenCalledWith(applications)
  expect(valuesMocks[0]).toHaveBeenCalledWith(
    expect.objectContaining({ jobId: baseJob.id, status: 'applied', result: 'submitted' }),
  )

  expect(mockDb.update).toHaveBeenCalledTimes(1)
  expect(mockDb.update).toHaveBeenCalledWith(jobs)
  expect(setMocks[0]).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'applied', updatedAt: expect.any(Date) }),
  )
})

test('runEasyApplyJob records failed status and screenshot on error', async () => {
  mockAgent.generate.mockRejectedValueOnce(new Error('form not found'))

  await expect(runEasyApplyJob(baseJob, 'profile text', '/tmp/resume.pdf')).rejects.toThrow('form not found')

  expect(mockTakeScreenshot).toHaveBeenCalledTimes(1)
  expect(mockTakeScreenshot).toHaveBeenCalledWith(expect.stringContaining(`easy-${baseJob.id}`))

  expect(mockDb.insert).toHaveBeenCalledTimes(1)
  expect(mockDb.insert).toHaveBeenCalledWith(applications)
  expect(valuesMocks[0]).toHaveBeenCalledWith(
    expect.objectContaining({ jobId: baseJob.id, status: 'failed', error: 'form not found' }),
  )

  expect(mockDb.update).toHaveBeenCalledTimes(1)
  expect(mockDb.update).toHaveBeenCalledWith(jobs)
  expect(setMocks[0]).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'failed', updatedAt: expect.any(Date) }),
  )
})
