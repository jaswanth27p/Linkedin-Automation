import { Worker } from 'bullmq'
import { redis } from './connection.ts'
import { runExternalApplyJob } from '../agents/external-apply-agent.ts'
import { appEvents } from '../utils/app-events.ts'
import { deadLetterQueue } from './dead-letter.queue.ts'
import type { ApplyJobData } from './search.queue.ts'

export function createExternalApplyWorker(profileText: string, resumePath: string) {
  const worker = new Worker<ApplyJobData>(
    'external-apply',
    async (job) => {
      appEvents.setState({ activeJob: { title: job.data.title, company: job.data.company } })
      try {
        await runExternalApplyJob(job.data, profileText, resumePath)
      } finally {
        appEvents.setState({ activeJob: null })
      }
    },
    {
      connection: redis as any,
      concurrency: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  )

  worker.on('failed', (job, _err) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      deadLetterQueue.add(job.name, job.data, { jobId: job.id })
    }
  })

  return worker
}
