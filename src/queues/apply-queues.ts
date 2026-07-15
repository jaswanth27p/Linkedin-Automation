import { Queue } from 'bullmq'
import { getRedisConnectionOptions } from './connection.ts'

export type ApplyType = 'easy' | 'external'

let easyQueue: Queue | null = null
let externalQueue: Queue | null = null

function getEasyQueue(): Queue {
  if (!easyQueue) easyQueue = new Queue('easy-apply', { connection: getRedisConnectionOptions() })
  return easyQueue
}

function getExternalQueue(): Queue {
  if (!externalQueue) externalQueue = new Queue('external-apply', { connection: getRedisConnectionOptions() })
  return externalQueue
}

export async function enqueueApplyJob(applyType: ApplyType, jobId: string): Promise<void> {
  const queue = applyType === 'easy' ? getEasyQueue() : getExternalQueue()
  await queue.add('apply', { jobId })
}

export async function getApplyQueueCounts(applyType: ApplyType): Promise<{ waiting: number; active: number }> {
  const queue = applyType === 'easy' ? getEasyQueue() : getExternalQueue()
  const counts = await queue.getJobCounts('waiting', 'active')
  return { waiting: counts.waiting ?? 0, active: counts.active ?? 0 }
}
