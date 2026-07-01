import { Queue } from 'bullmq'
import type { SearchJobData } from '../agents/search-agent.ts'
import type { AppConfig } from '../config/schema.ts'

export async function scheduleSearchJobs(searchQueue: Queue<SearchJobData>, config: AppConfig) {
  const { recent, full } = config.cron

  await searchQueue.add(
    'recent-search',
    { urls: config.mustCheckUrls, requirements: config.requirements, profileText: '', postedWithinMinutes: recent.postedWithinMinutes },
    { repeat: { key: 'recent-search', every: recent.intervalMinutes * 60 * 1000 } }
  )

  await searchQueue.add(
    'full-search',
    { urls: config.mustCheckUrls, requirements: config.requirements, profileText: '' },
    { repeat: { key: 'full-search', every: full.intervalMinutes * 60 * 1000 } }
  )
}

export async function unscheduleSearchJobs(searchQueue: Queue) {
  await searchQueue.removeRepeatableByKey('recent-search')
  await searchQueue.removeRepeatableByKey('full-search')
}
