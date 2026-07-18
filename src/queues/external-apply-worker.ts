import { Worker, type Job } from 'bullmq'
import { and, count, eq, gte } from 'drizzle-orm'
import { getRedisConnectionOptions } from './connection.ts'
import { getApplyQueueCounts } from './apply-queues.ts'
import { processExternalApplyJob } from '../agents/external-apply-agent.ts'
import { getDb } from '../db/index.ts'
import { applications, jobs } from '../db/schema.ts'
import { pushLog, setAgentStatus } from '../state/app-state.ts'
import type { TabId } from '../state/types.ts'

const EXTERNAL_TAB: TabId = 'external'

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

function domainFor(applyUrl: string): string | null {
  try {
    return new URL(applyUrl).hostname
  } catch {
    return null
  }
}

export function isExternalApplyWorkerRunning(): boolean {
  return worker !== null
}

export function startExternalApplyWorker(): void {
  if (worker) return

  worker = new Worker(
    'external-apply',
    async (job: Job<{ jobId: string }>) => {
      const db = getDb()
      const [counts, appliedToday, rows] = await Promise.all([
        getApplyQueueCounts('external'),
        appliedTodayCount(),
        db.select({ applyUrl: jobs.applyUrl }).from(jobs).where(eq(jobs.id, job.data.jobId)),
      ])
      const domain = rows[0] ? domainFor(rows[0].applyUrl) : null
      const domainSuffix = domain ? `, site: ${domain}` : ''
      setAgentStatus(EXTERNAL_TAB, 'running', `queue: ${counts.waiting} left, applied today: ${appliedToday}${domainSuffix}`)
      await processExternalApplyJob(job.data.jobId)
    },
    { connection: getRedisConnectionOptions(), concurrency: 1 },
  )

  worker.on('failed', (_job, err) => {
    pushLog(EXTERNAL_TAB, `Worker error: ${err.message}`)
  })
  // Required: an EventEmitter with no 'error' listener throws on emit,
  // which would otherwise crash the process on a Redis connection hiccup.
  worker.on('error', (err) => {
    pushLog(EXTERNAL_TAB, `Worker connection error: ${err.message}`)
  })

  pushLog(EXTERNAL_TAB, 'External Apply worker started.')
  setAgentStatus(EXTERNAL_TAB, 'running', 'waiting for jobs')
}

export async function stopExternalApplyWorker(): Promise<void> {
  if (!worker) return
  await worker.close()
  worker = null
  pushLog(EXTERNAL_TAB, 'External Apply worker stopped.')
  setAgentStatus(EXTERNAL_TAB, 'idle', null)
}
