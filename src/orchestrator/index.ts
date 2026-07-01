import { EventEmitter } from 'node:events'
import { Queue, Worker } from 'bullmq'
import { redis } from '../queues/connection.ts'
import { searchQueue } from '../queues/search.queue.ts'
import { createEasyApplyWorker } from '../queues/easy-apply.queue.ts'
import { createExternalApplyWorker } from '../queues/external-apply.queue.ts'
import { runSearchJob, type SearchJobData } from '../agents/search-agent.ts'
import { scheduleSearchJobs, unscheduleSearchJobs } from '../scheduler/index.ts'
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
  }

  async start(mode: RunMode) {
    if (this.isRunning) await this.stop()

    this.workers.push(createEasyApplyWorker(this.deps.profileText, this.deps.resumePath))
    this.workers.push(createExternalApplyWorker(this.deps.profileText, this.deps.resumePath))

    const searchWorker = new Worker<SearchJobData>(
      'search',
      async (job) => {
        const data = { ...job.data, profileText: this.deps.profileText }
        await runSearchJob(data)
      },
      { connection: redis as any, concurrency: 1 }
    )
    this.workers.push(searchWorker)

    if (mode === 'recent-search') {
      await searchQueue.add('recent-search', { urls: this.deps.config.mustCheckUrls, requirements: this.deps.config.requirements, profileText: this.deps.profileText, postedWithinMinutes: this.deps.config.cron.recent.postedWithinMinutes })
    } else if (mode === 'full-search') {
      await searchQueue.add('full-search', { urls: this.deps.config.mustCheckUrls, requirements: this.deps.config.requirements, profileText: this.deps.profileText })
    } else if (mode === 'full-run') {
      await scheduleSearchJobs(searchQueue, this.deps.config)
    }

    this.isRunning = true
    this.emit('started', mode)
  }

  async stop() {
    await unscheduleSearchJobs(searchQueue)
    await Promise.all(this.workers.map(w => w.close()))
    this.workers = []
    this.isRunning = false
    this.emit('stopped')
  }
}
