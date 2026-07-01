import { Queue } from 'bullmq'
import type { SearchJobData } from '../agents/search-agent.ts'
import type { AppConfig } from '../config/schema.ts'

export async function scheduleSearchJobs(searchQueue: Queue<SearchJobData>, config: AppConfig) {
  const { recent, full } = config.cron

  await searchQueue.add(
    'recent-search',
    { urls: config.mustCheckUrls, requirements: config.requirements, profileText: '', postedWithinMinutes: recent.postedWithinMinutes },
    { repeat: { every: recent.intervalMinutes * 60 * 1000 }, jobId: 'repeat:recent-search' }
  )

  await searchQueue.add(
    'full-search',
    { urls: config.mustCheckUrls, requirements: config.requirements, profileText: '' },
    { repeat: { every: full.intervalMinutes * 60 * 1000 }, jobId: 'repeat:full-search' }
  )
}

export async function unscheduleSearchJobs(searchQueue: Queue) {
  await searchQueue.removeRepeatableByKey('repeat:recent-search')
  await searchQueue.removeRepeatableByKey('repeat:full-search')
}
