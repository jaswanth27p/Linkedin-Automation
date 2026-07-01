import { test, expect, vi } from 'vitest'
import { scheduleSearchJobs, unscheduleSearchJobs } from '../../../src/scheduler/index.ts'
import type { AppConfig } from '../../../src/config/schema.ts'

function createMockQueue() {
  return {
    add: vi.fn(),
    removeRepeatableByKey: vi.fn(),
  }
}

const baseConfig = {
  mustCheckUrls: ['https://linkedin.com/jobs/search'],
  requirements: 'TypeScript backend role',
  cron: {
    recent: { intervalMinutes: 60, postedWithinMinutes: 60 },
    full: { intervalMinutes: 1440 },
  },
  concurrency: 1,
  profileFiles: { profile: 'profile.txt', resume: 'resume.pdf' },
  model: 'opencode-go/kimi-k2.7-code',
} satisfies AppConfig

test('scheduleSearchJobs adds recent and full repeatable jobs with stable keys', async () => {
  const queue = createMockQueue()

  await scheduleSearchJobs(queue as any, baseConfig)

  expect(queue.add).toHaveBeenCalledTimes(2)
  expect(queue.add).toHaveBeenCalledWith(
    'recent-search',
    expect.objectContaining({
      urls: baseConfig.mustCheckUrls,
      requirements: baseConfig.requirements,
      profileText: '',
      postedWithinMinutes: 60,
    }),
    { repeat: { key: 'recent-search', every: 60 * 60 * 1000 } }
  )
  expect(queue.add).toHaveBeenCalledWith(
    'full-search',
    expect.objectContaining({
      urls: baseConfig.mustCheckUrls,
      requirements: baseConfig.requirements,
      profileText: '',
    }),
    { repeat: { key: 'full-search', every: 1440 * 60 * 1000 } }
  )
})

test('unscheduleSearchJobs removes both repeatable jobs by key', async () => {
  const queue = createMockQueue()

  await unscheduleSearchJobs(queue as any)

  expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(2)
  expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('recent-search')
  expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('full-search')
})
