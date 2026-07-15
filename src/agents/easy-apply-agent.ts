import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { AgentBrowser } from '@mastra/agent-browser'
import { getSharedCdpUrl } from '../browser/session.ts'
import { getCurrentConfig } from '../config/current.ts'
import { getDb } from '../db/index.ts'
import { jobs, applications } from '../db/schema.ts'
import { loadResume, loadProfile, saveLearnedAnswer } from '../profile/loader.ts'
import { findLearnedAnswer } from '../profile/answer-matching.ts'
import { appState, pushLog, setAgentStatus } from '../state/app-state.ts'
import { waitForAnswer } from '../state/prompt-channel.ts'
import { noOpBrowserContextProcessor } from './no-op-browser-context-processor.ts'
import type { AppConfig } from '../config/schema.ts'
import type { TabId } from '../state/types.ts'

const EASY_TAB: TabId = 'easy'
const SCREENSHOT_DIR = './data/screenshots'

let sharedBrowser: AgentBrowser | null = null

function getEasyApplyBrowser(): AgentBrowser {
  if (!sharedBrowser) {
    sharedBrowser = new AgentBrowser({
      cdpUrl: getSharedCdpUrl(),
      scope: 'shared',
      headless: false,
      excludeTools: ['browser_screenshot'],
    })
  }
  return sharedBrowser
}

interface JobRecord {
  id: string
  title: string
  company: string
  applyUrl: string
}

function createLookupLearnedAnswerTool(config: AppConfig) {
  return createTool({
    id: 'lookup-learned-answer',
    description:
      "Check whether this exact application question has a previously-learned answer in profile.json. Call this for any form question not directly answerable from the structured profile fields already given to you.",
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ found: z.boolean(), answer: z.string().nullable() }),
    execute: async ({ question }) => {
      const profile = await loadProfile(config.profileFiles.profile)
      const answer = findLearnedAnswer(question, profile.answers)
      return { found: answer !== null, answer }
    },
  })
}

function createAskHumanAndRememberTool(config: AppConfig) {
  return createTool({
    id: 'ask-human-and-remember',
    description:
      "Ask the human for the answer to a genuinely unknown application question (not inferable from resume/profile, and not a previously-learned answer). The answer is saved so this question is never asked again.",
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
    execute: async ({ question }) => {
      pushLog(EASY_TAB, `Needs input: ${question}`)
      const answer = await waitForAnswer(EASY_TAB, question)
      setAgentStatus(EASY_TAB, 'running')
      await saveLearnedAnswer(config.profileFiles.profile, question, answer)
      pushLog(EASY_TAB, `Got answer: ${answer} (saved for next time)`)
      return { answer }
    },
  })
}

interface SubmissionContext {
  reported: boolean
}

function createReportSubmissionTool(job: JobRecord, browser: AgentBrowser, ctx: SubmissionContext) {
  return createTool({
    id: 'report-submission',
    description:
      'Report the final result of this application. Call this exactly once, after you submit the application (success) or after you determine you cannot complete it (failure).',
    inputSchema: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input) => {
      ctx.reported = true
      const db = getDb()

      if (input.success) {
        let screenshotPath: string | null = null
        try {
          const shot = await browser.screenshot({ fullPage: false })
          if ('base64' in shot) {
            await mkdir(SCREENSHOT_DIR, { recursive: true })
            screenshotPath = join(SCREENSHOT_DIR, `${job.id}-${Date.now()}.png`)
            await writeFile(screenshotPath, Buffer.from(shot.base64, 'base64'))
          }
        } catch {
          // Screenshot is best-effort proof, not required for a successful application.
        }

        await db.insert(applications).values({
          id: randomUUID(),
          jobId: job.id,
          status: 'applied',
          result: 'Applied successfully',
          screenshotPath,
        })
        await db.update(jobs).set({ status: 'applied', updatedAt: new Date() }).where(eq(jobs.id, job.id))
        pushLog(EASY_TAB, `Applied: ${job.title} @ ${job.company}`)
      } else {
        await db.insert(applications).values({
          id: randomUUID(),
          jobId: job.id,
          status: 'failed',
          error: input.error ?? 'Unknown failure',
        })
        await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
        pushLog(EASY_TAB, `Failed: ${job.title} @ ${job.company} — ${input.error ?? 'unknown failure'}`)
      }

      return { ok: true }
    },
  })
}

async function buildApplyInstructions(config: AppConfig, job: JobRecord): Promise<string> {
  const resume = await loadResume(config.profileFiles.resume)
  const profile = await loadProfile(config.profileFiles.profile)

  return `
You are filling out a LinkedIn Easy Apply form in a real, already-logged-in browser.

Job: ${job.title} @ ${job.company}
Apply URL: ${job.applyUrl}

Candidate resume:
${resume}

Candidate profile (structured):
${JSON.stringify(profile, null, 2)}

Steps:
1. Open the apply URL and click "Easy Apply".
2. Step through the form. For each field/question, resolve it in this order:
   a. If it maps directly to a structured profile field above (contact info, work authorization, salary expectation, years of experience, links), use that value directly.
   b. Otherwise, call lookup-learned-answer with the exact on-page question text. If found is true, use that answer.
   c. Otherwise, if you can confidently infer the answer from the resume/profile content, answer it yourself.
   d. Otherwise — a genuine unknown — call ask-human-and-remember with the question, then use the returned answer.
3. Submit the application once all steps are complete.
4. Call report-submission with success: true after a successful submission, or success: false with a short error if you get stuck in a way you cannot resolve (broken page, unexpected error, application form crashed). Call it exactly once, at the very end.
`.trim()
}

export async function processEasyApplyJob(jobId: string): Promise<void> {
  const db = getDb()
  const rows = await db.select().from(jobs).where(eq(jobs.id, jobId))
  const job = rows[0]

  if (!job) {
    pushLog(EASY_TAB, `Job ${jobId} not found in database — skipping.`)
    return
  }

  if (job.status === 'applied' || job.status === 'failed' || job.status === 'skipped') {
    pushLog(EASY_TAB, `Job ${jobId} already ${job.status} — skipping.`)
    return
  }

  const config = getCurrentConfig()

  const jobRecord: JobRecord = { id: job.id, title: job.title, company: job.company, applyUrl: job.applyUrl }
  const ctx: SubmissionContext = { reported: false }
  const browser = getEasyApplyBrowser()

  try {
    const instructions = await buildApplyInstructions(config, jobRecord)
    const agent = new Agent({
      id: 'easy-apply-agent',
      name: 'Easy Apply Agent',
      instructions,
      model: appState.settings.model,
      browser,
      inputProcessors: [noOpBrowserContextProcessor],
      tools: {
        lookupLearnedAnswer: createLookupLearnedAnswerTool(config),
        askHumanAndRemember: createAskHumanAndRememberTool(config),
        reportSubmission: createReportSubmissionTool(jobRecord, browser, ctx),
      },
    })

    pushLog(EASY_TAB, `Opening application: ${job.title} @ ${job.company}`)
    // Mastra's Agent.generate defaults maxSteps to 5 tool-call steps total — a
    // real multi-field application (open, fill several fields, maybe multiple
    // Easy Apply pages, report-submission) blows past that easily, so without
    // this the agent silently stops mid-form and the job gets written as
    // failed even though nothing actually went wrong. Not set to something huge/
    // unbounded, though: this is the ONLY circuit breaker against a genuinely
    // stuck agent (e.g. repeatedly retrying the same failed click) — the BullMQ
    // worker (concurrency: 1) has no job timeout, so a runaway loop would burn
    // tokens and block every other queued application indefinitely otherwise.
    await agent.generate(`Apply to this job now. Job detail/apply URL: ${jobRecord.applyUrl}`, { maxSteps: 150 })
  } catch (err) {
    if (!ctx.reported) {
      const message = err instanceof Error ? err.message : String(err)
      await db.insert(applications).values({ id: randomUUID(), jobId: job.id, status: 'failed', error: message })
      await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
      pushLog(EASY_TAB, `Failed: ${job.title} @ ${job.company} — ${message}`)
    }
    return
  }

  if (!ctx.reported) {
    const message = 'Agent finished without reporting a result'
    await db.insert(applications).values({ id: randomUUID(), jobId: job.id, status: 'failed', error: message })
    await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
    pushLog(EASY_TAB, `Failed: ${job.title} @ ${job.company} — ${message}`)
  }
}
