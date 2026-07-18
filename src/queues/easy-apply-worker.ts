import { Worker, type Job } from 'bullmq'
import { and, count, eq, gte } from 'drizzle-orm'
import { getRedisConnectionOptions } from './connection.ts'
import { getApplyQueueCounts } from './apply-queues.ts'
import { processEasyApplyJob } from '../agents/easy-apply-agent.ts'
import { getDb } from '../db/index.ts'
import { applications } from '../db/schema.ts'
import { pushLog, setAgentStatus } from '../state/app-state.ts'
import type { TabId } from '../state/types.ts'

const EASY_TAB: TabId = 'easy'

let worker: Worker | null = null

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

async function appliedTodayCount(): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ n: count() })
    .from(applications)
    .where(and(eq(applications.status, 'applied'), gte(applications.createdAt, startOfToday())))
  return rows[0]?.n ?? 0
}

export function isEasyApplyWorkerRunning(): boolean {
  return worker !== null
}

export function startEasyApplyWorker(): void {
  if (worker) return

  worker = new Worker(
    'easy-apply',
    async (job: Job<{ jobId: string }>) => {
      const [counts, appliedToday] = await Promise.all([getApplyQueueCounts('easy'), appliedTodayCount()])
      setAgentStatus(EASY_TAB, 'running', `queue: ${counts.waiting} left, applied today: ${appliedToday}`)
      await processEasyApplyJob(job.data.jobId)
    },
    { connection: getRedisConnectionOptions(), concurrency: 1 },
  )

  worker.on('failed', (_job, err) => {
    pushLog(EASY_TAB, `Worker error: ${err.message}`)
  })
  // Required: an EventEmitter with no 'error' listener throws on emit,
  // which would otherwise crash the process on a Redis connection hiccup.
  worker.on('error', (err) => {
    pushLog(EASY_TAB, `Worker connection error: ${err.message}`)
  })

  pushLog(EASY_TAB, 'Easy Apply worker started.')
  setAgentStatus(EASY_TAB, 'running', 'waiting for jobs')
}

export async function stopEasyApplyWorker(): Promise<void> {
  if (!worker) return
  await worker.close()
  worker = null
  pushLog(EASY_TAB, 'Easy Apply worker stopped.')
  setAgentStatus(EASY_TAB, 'idle', null)
}
