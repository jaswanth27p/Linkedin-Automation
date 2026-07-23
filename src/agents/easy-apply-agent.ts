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
import { jobs, applications, type RecordedAnswer, type AnswerSource } from '../db/schema.ts'
import { loadResume, loadProfile, saveLearnedAnswer } from '../profile/loader.ts'
import { findLearnedAnswer } from '../profile/answer-matching.ts'
import { appState, pushLog, setAgentStatus } from '../state/app-state.ts'
import { waitForAnswer } from '../state/prompt-channel.ts'
import { recordEasyApplyResult } from '../notify/summary-aggregator.ts'
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

export interface JobRecord {
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

/** Set by report-submission's execute. 'written' means the applications/jobs
 * rows are already persisted (success, or a non-recoverable/'blocked' failure)
 * — processEasyApplyJob just returns. missingInfo (written: false) means the
 * failure is a specific unanswered question — processEasyApplyJob asks the
 * human right there and retries the same job before writing anything. */
export type SubmissionOutcome =
  | { success: true }
  | { success: false; written: true }
  | { success: false; written: false; missingInfo: true; question: string; error: string }

export interface SubmissionContext {
  reported: boolean
  answers: RecordedAnswer[]
  outcome?: SubmissionOutcome
}

/** Shared by report-submission's non-recoverable branch and every fallback
 * failure path in processEasyApplyJob (thrown error, agent never reported,
 * missing-info retries exhausted) — one persisted shape, one log line (with
 * the apply URL, so it's actionable without opening the DB), one recorded
 * summary-notification count, one place a human can navigate from later via
 * the dashboard. */
async function writeFailedApplication(
  job: JobRecord,
  error: string,
  failureReason: 'missing_info' | 'blocked',
  question: string | null,
  answers: RecordedAnswer[],
): Promise<void> {
  const db = getDb()
  await db.insert(applications).values({
    id: randomUUID(),
    jobId: job.id,
    status: 'failed',
    error,
    failureReason,
    missingInfoQuestion: question,
    answers,
  })
  await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
  pushLog(EASY_TAB, `Failed: ${job.title} @ ${job.company} (${job.applyUrl}) — ${error}`)
  recordEasyApplyResult(false)
}

/** Exported so the answer-tracking flow can be tested directly against a fake
 * ctx/browser without a live LLM or browser session. */
export function createRecordAnswerTool(ctx: SubmissionContext) {
  return createTool({
    id: 'record-answer',
    description:
      "Record the question and answer you just used for a form field, and how you resolved it. Call this for EVERY field you fill, regardless of which resolution path you used (structured profile field, lookup-learned-answer, your own inference, or ask-human-and-remember) — this is the only record of what was actually submitted, for later human review.",
    inputSchema: z.object({
      question: z.string(),
      answer: z.string(),
      source: z.enum(['profile', 'learned', 'inferred', 'human']),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async ({ question, answer, source }) => {
      ctx.answers.push({ question, answer, source: source as AnswerSource })
      return { ok: true }
    },
  })
}

/** Exported so the answer-tracking flow can be tested directly against a fake
 * ctx/browser without a live LLM or browser session. */
export function createReportSubmissionTool(job: JobRecord, browser: AgentBrowser, ctx: SubmissionContext) {
  return createTool({
    id: 'report-submission',
    description:
      'Report the final result of this application. Call this exactly once, after you submit the application (success) or after you determine you cannot complete it (failure).',
    inputSchema: z.object({
      success: z.boolean(),
      error: z.string().optional(),
      reason: z.enum(['missing_info', 'blocked']).optional(),
      question: z.string().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input) => {
      ctx.reported = true

      if (input.success) {
        const db = getDb()
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
          answers: ctx.answers,
        })
        await db.update(jobs).set({ status: 'applied', updatedAt: new Date() }).where(eq(jobs.id, job.id))
        pushLog(EASY_TAB, `Applied: ${job.title} @ ${job.company}`)
        recordEasyApplyResult(true)
        ctx.outcome = { success: true }
      } else if (input.reason === 'missing_info' && input.question) {
        // Don't persist yet — processEasyApplyJob asks the human for this exact
        // question right now and retries the same job before anything is written.
        ctx.outcome = { success: false, written: false, missingInfo: true, question: input.question, error: input.error ?? 'Missing information' }
      } else {
        const error = input.error ?? 'Unknown failure'
        await writeFailedApplication(job, error, 'blocked', null, ctx.answers)
        ctx.outcome = { success: false, written: true }
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
   e. Regardless of which path (a-d) you used, call record-answer with the question, the answer you used, and which path resolved it (source: "profile", "learned", "inferred", or "human"). This is mandatory for EVERY field — it is the only record of what was actually submitted, for later human review. Do this before moving to the next field.
3. If the form has a resume step, LinkedIn Easy Apply reuses a resume already uploaded to the candidate's LinkedIn account — it will be pre-selected automatically. Just confirm/continue past that step; do not try to upload a file. Only if the step shows no resume at all and forces a fresh upload with no way to proceed, call ask-human-and-remember asking the human to attach one manually in the visible browser, then continue once they confirm.
4. Submit the application once all steps are complete.
5. Call report-submission with success: true after a successful submission. If you get stuck in a way you cannot resolve, call it with success: false and one of:
   - reason: "missing_info", question: "<the exact on-page question text>" — only if you truly could not get an answer for a specific required field (e.g. ask-human-and-remember's answer still didn't satisfy the form's validation). The app asks the human that one question immediately and retries this application right away — no separate command needed.
   - reason: "blocked" (or omit reason) — for anything else: broken page, unexpected error, application form crashed. This is not auto-retryable, so only use "missing_info" when you can name the exact question.
   Call report-submission exactly once, at the very end.
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
  const browser = getEasyApplyBrowser()

  // Bounded so a job that keeps needing new info can't loop forever — after
  // this many "ask human, retry" rounds it's written as failed instead of
  // retried again. A genuinely blocked/technical failure never loops at all,
  // it's written on the first pass (see the 'blocked' branch below).
  const MAX_ATTEMPTS = 3
  let carriedAnswers: RecordedAnswer[] = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctx: SubmissionContext = { reported: false, answers: [...carriedAnswers] }

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
          recordAnswer: createRecordAnswerTool(ctx),
          reportSubmission: createReportSubmissionTool(jobRecord, browser, ctx),
        },
      })

      pushLog(
        EASY_TAB,
        attempt === 1
          ? `Opening application: ${job.title} @ ${job.company}`
          : `Retrying application (attempt ${attempt}/${MAX_ATTEMPTS}): ${job.title} @ ${job.company}`,
      )
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
        await writeFailedApplication(jobRecord, message, 'blocked', null, ctx.answers)
      }
      return
    }

    if (!ctx.reported) {
      await writeFailedApplication(jobRecord, 'Agent finished without reporting a result', 'blocked', null, ctx.answers)
      return
    }

    const outcome = ctx.outcome
    if (!outcome || outcome.success || outcome.written) return

    // missing_info, not yet persisted — ask the human right now, no command needed.
    if (attempt < MAX_ATTEMPTS) {
      pushLog(EASY_TAB, `${job.title} @ ${job.company} needs: ${outcome.question}`)
      const answer = await waitForAnswer(EASY_TAB, outcome.question)
      setAgentStatus(EASY_TAB, 'running')
      await saveLearnedAnswer(config.profileFiles.profile, outcome.question, answer)
      pushLog(EASY_TAB, `Got answer — retrying: ${job.title} @ ${job.company}`)
      carriedAnswers = ctx.answers
      continue
    }

    await writeFailedApplication(jobRecord, outcome.error, 'missing_info', outcome.question, ctx.answers)
    return
  }
}
