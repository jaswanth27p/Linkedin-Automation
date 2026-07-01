import { Worker } from 'bullmq'
import { redis } from './connection.ts'
import { runEasyApplyJob } from '../agents/easy-apply-agent.ts'
import type { ApplyJobData } from './search.queue.ts'

export function createEasyApplyWorker(profileText: string, resumePath: string) {
  return new Worker<ApplyJobData>(
    'easy-apply',
    async (job) => {
      await runEasyApplyJob(job.data, profileText, resumePath)
    },
    {
      connection: redis as any,
      concurrency: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  )
}
