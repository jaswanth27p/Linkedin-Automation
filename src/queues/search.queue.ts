import { createQueue } from './connection.ts'
import { getDb } from '../db/index.ts'
import { jobs } from '../db/schema.ts'
import type { SearchJobData } from '../agents/search-agent.ts'

export interface ApplyJobData {
  id: string
  title: string
  company: string
  location?: string
  applyUrl: string
  applyType: 'easy' | 'external'
  sourceUrl: string
  answer?: string
}

const easyApplyQueue = createQueue<ApplyJobData>('easy-apply')
const externalApplyQueue = createQueue<ApplyJobData>('external-apply')
export const searchQueue = createQueue<SearchJobData>('search')

export async function enqueueJobs(jobsToEnqueue: ApplyJobData[]) {
  const db = getDb()
  for (const job of jobsToEnqueue) {
    await db.insert(jobs).values({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      applyUrl: job.applyUrl,
      applyType: job.applyType,
      sourceUrl: job.sourceUrl,
      status: 'queued',
    }).onConflictDoNothing({ target: jobs.id })

    const queue = job.applyType === 'easy' ? easyApplyQueue : externalApplyQueue
    const name = `${job.applyType}:${job.id}`
    await queue.add(name, job, { jobId: name })
  }
}

export { easyApplyQueue, externalApplyQueue }
