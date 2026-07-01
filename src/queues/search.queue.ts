import { createQueue } from './connection.ts'

export interface ApplyJobData {
  id: string
  title: string
  company: string
  location?: string
  applyUrl: string
  applyType: 'easy' | 'external'
  sourceUrl: string
}

const easyApplyQueue = createQueue<ApplyJobData>('easy-apply')
const externalApplyQueue = createQueue<ApplyJobData>('external-apply')

export async function enqueueJobs(jobs: ApplyJobData[]) {
  for (const job of jobs) {
    const queue = job.applyType === 'easy' ? easyApplyQueue : externalApplyQueue
    const name = `${job.applyType}:${job.id}` as string
    await queue.add(name, job, { jobId: name })
  }
}

export { easyApplyQueue, externalApplyQueue }
