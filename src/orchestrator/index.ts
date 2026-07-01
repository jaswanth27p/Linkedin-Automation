import { EventEmitter } from 'node:events'
import { Worker } from 'bullmq'
import { desc, eq } from 'drizzle-orm'
import { redis } from '../queues/connection.ts'
import { searchQueue, easyApplyQueue, externalApplyQueue } from '../queues/search.queue.ts'
import { createEasyApplyWorker } from '../queues/easy-apply.queue.ts'
import { createExternalApplyWorker } from '../queues/external-apply.queue.ts'
import { runSearchJob, type SearchJobData } from '../agents/search-agent.ts'
import { scheduleSearchJobs, unscheduleSearchJobs } from '../scheduler/index.ts'
import { getDb } from '../db/index.ts'
import { applications, jobs } from '../db/schema.ts'
import { logToTui } from '../utils/logger.ts'
import type { AppConfig } from '../config/schema.ts'

export type RunMode = 'recent-search' | 'full-search' | 'apply-only' | 'full-run'

interface OrchestratorDeps {
  profileText: string
  resumePath: string
  config: AppConfig
}

export class Orchestrator extends EventEmitter {
  private workers: Worker[] = []
  public isRunning = false

  constructor(private deps: OrchestratorDeps) {
    super()
    this.on('resume', (answer: string) => this.handleResume(answer))
  }

  async start(mode: RunMode) {
    if (this.isRunning) await this.stop()

    if (mode === 'recent-search') {
      await searchQueue.add('recent-search', { urls: this.deps.config.mustCheckUrls, requirements: this.deps.config.requirements, profileText: this.deps.profileText, postedWithinMinutes: this.deps.config.cron.recent.postedWithinMinutes })
    } else if (mode === 'full-search') {
      await searchQueue.add('full-search', { urls: this.deps.config.mustCheckUrls, requirements: this.deps.config.requirements, profileText: this.deps.profileText })
    } else if (mode === 'full-run') {
      await scheduleSearchJobs(searchQueue, this.deps.config)
    }

    this.workers.push(createEasyApplyWorker(this.deps.profileText, this.deps.resumePath))
    this.workers.push(createExternalApplyWorker(this.deps.profileText, this.deps.resumePath))

    const searchWorker = new Worker<SearchJobData>(
      'search',
      async (job) => {
        const data = { ...job.data, profileText: this.deps.profileText }
        await runSearchJob(data)
      },
      {
        connection: redis as any,
        concurrency: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      }
    )
    this.workers.push(searchWorker)

    this.isRunning = true
    this.emit('started', mode)
    logToTui(`orchestrator started: ${mode}`)
  }

  async stop() {
    await unscheduleSearchJobs(searchQueue)
    await Promise.all(this.workers.map(w => w.close()))
    this.workers = []
    this.isRunning = false
    this.emit('stopped')
    logToTui('orchestrator stopped')
  }

  private async handleResume(answer: string) {
    const db = getDb()
    const row = await db.select()
      .from(applications)
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .where(eq(applications.status, 'needs_input'))
      .orderBy(desc(applications.createdAt))
      .limit(1)
      .get()

    if (!row || !row.jobs) {
      logToTui('resume warning: no needs_input application found')
      return
    }

    const job = row.jobs
    const queue = job.applyType === 'easy' ? easyApplyQueue : externalApplyQueue
    const name = `${job.applyType}:${job.id}`
    const jobData = {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location ?? undefined,
      applyUrl: job.applyUrl,
      applyType: job.applyType,
      sourceUrl: job.sourceUrl,
      answer,
    }

    await queue.remove(name)
    await queue.add(name, jobData, { jobId: name })
    logToTui(`resumed ${job.applyType} job: ${job.title} @ ${job.company}`)
  }
}
