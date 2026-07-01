import { Worker } from 'bullmq'
import { redis } from './connection.ts'
import { runExternalApplyJob } from '../agents/external-apply-agent.ts'
import type { ApplyJobData } from './search.queue.ts'

export function createExternalApplyWorker(profileText: string, resumePath: string) {
  return new Worker<ApplyJobData>(
    'external-apply',
    async (job) => {
      await runExternalApplyJob(job.data, profileText, resumePath)
    },
    {
      connection: redis as any,
      concurrency: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  )
}
