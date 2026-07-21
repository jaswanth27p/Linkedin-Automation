import { Queue } from 'bullmq'
import { getRedisConnectionOptions } from './connection.ts'

let easyQueue: Queue | null = null

function getEasyQueue(): Queue {
  if (!easyQueue) easyQueue = new Queue('easy-apply', { connection: getRedisConnectionOptions() })
  return easyQueue
}

export async function enqueueApplyJob(jobId: string): Promise<void> {
  const queue = getEasyQueue()
  // Bounded retention: without these, every completed/failed BullMQ job stays
  // in Redis forever and the instance grows without limit. The Postgres
  // `applications` table is the durable record; Redis only needs enough
  // history to debug recent runs.
  await queue.add('apply', { jobId }, { removeOnComplete: 500, removeOnFail: 1000 })
}

export async function getApplyQueueCounts(): Promise<{ waiting: number; active: number }> {
  const queue = getEasyQueue()
  const counts = await queue.getJobCounts('waiting', 'active')
  return { waiting: counts.waiting ?? 0, active: counts.active ?? 0 }
}

/** The Queue lazily created above opens its own ioredis connection that keeps
 * the process alive on its own — a BullMQ Worker being closed does NOT close
 * the separate producer-side Queue connection. Must be called on shutdown or
 * the process hangs after /exit (only escapable via Ctrl+C) whenever a job was
 * ever enqueued or a queue count was checked that session. */
export async function closeApplyQueues(): Promise<void> {
  await easyQueue?.close()
  easyQueue = null
}
