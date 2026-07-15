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

const EXTERNAL_TAB: TabId = 'external'
const SCREENSHOT_DIR = './data/screenshots'

let sharedBrowser: AgentBrowser | null = null

function getExternalApplyBrowser(): AgentBrowser {
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
      'Ask the human for the answer to a genuinely unknown application question (not inferable from resume/profile, and not a previously-learned answer). The answer is saved so this question is never asked again. Do NOT use this for email verification codes or links, CAPTCHAs, or 2FA — use ask-human-for-verification for those instead.',
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
    execute: async ({ question }) => {
      pushLog(EXTERNAL_TAB, `Needs input: ${question}`)
      const answer = await waitForAnswer(EXTERNAL_TAB, question)
      setAgentStatus(EXTERNAL_TAB, 'running')
      await saveLearnedAnswer(config.profileFiles.profile, question, answer)
      pushLog(EXTERNAL_TAB, `Got answer: ${answer} (saved for next time)`)
      return { answer }
    },
  })
}

function createAskHumanForVerificationTool() {
  return createTool({
    id: 'ask-human-for-verification',
    description:
      "Ask the human for help with an email verification code (OTP) or confirmation link, a CAPTCHA, an SMS/2FA prompt, or any unrecognized signup/apply flow you cannot resolve yourself — you cannot read the candidate's email or phone. State clearly what you need (e.g. which email address and site a code was sent to). Waits for their typed reply. Unlike ask-human-and-remember, this answer is per-run and is never saved to profile.json — a verification code or a one-off confirmation is not a durable fact.",
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
    execute: async ({ question }) => {
      pushLog(EXTERNAL_TAB, `Needs input: ${question}`)
      const answer = await waitForAnswer(EXTERNAL_TAB, question)
      setAgentStatus(EXTERNAL_TAB, 'running')
      pushLog(EXTERNAL_TAB, 'Got answer.')
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
        pushLog(EXTERNAL_TAB, `Applied: ${job.title} @ ${job.company}`)
      } else {
        await db.insert(applications).values({
          id: randomUUID(),
          jobId: job.id,
          status: 'failed',
          error: input.error ?? 'Unknown failure',
        })
        await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
        pushLog(EXTERNAL_TAB, `Failed: ${job.title} @ ${job.company} — ${input.error ?? 'unknown failure'}`)
      }

      return { ok: true }
    },
  })
}

async function buildApplyInstructions(config: AppConfig, job: JobRecord): Promise<string> {
  const resume = await loadResume(config.profileFiles.resume)
  const profile = await loadProfile(config.profileFiles.profile)

  return `
You are completing a job application on an external (non-LinkedIn) careers site, in a real browser that already has a LinkedIn tab open and logged in.

Job: ${job.title} @ ${job.company}
Apply URL: ${job.applyUrl}

Candidate resume:
${resume}

Candidate profile (structured):
${JSON.stringify(profile, null, 2)}

Steps:
1. Open a NEW browser tab for the apply URL (browser_tabs action "new") — do not navigate the existing LinkedIn tab, it must stay open and logged in.
2. Step through the application form (and any account-creation step the site requires). For each field/question, resolve it in this order:
   a. If it maps directly to a structured profile field above (contact info, work authorization, salary expectation, years of experience, links), use that value directly. For an account-creation email field, use profile.contact.email.
   b. Otherwise, call lookup-learned-answer with the exact on-page question text. If found is true, use that answer.
   c. Otherwise, if you can confidently infer the answer from the resume/profile content, answer it yourself.
   d. Otherwise — a genuine unknown — call ask-human-and-remember with the question.
3. If the site requires email verification (a one-time code sent to profile.contact.email, or a confirmation link to click), call ask-human-for-verification with a question that states which email address was used and what's needed (the code, or confirmation that the link was clicked) — you cannot read the candidate's email yourself. Wait for the reply, then continue with it (enter the code, or proceed once told the link was clicked).
4. If you hit a CAPTCHA, SMS-only two-factor prompt, or any flow you don't recognize and cannot resolve, call ask-human-for-verification describing what you're stuck on, then continue with their guidance.
5. Submit the application once all steps are complete.
6. Call report-submission with success: true after a successful submission, or success: false with a short error if you get stuck in a way you cannot resolve. Call it exactly once, at the very end.
`.trim()
}

export async function processExternalApplyJob(jobId: string): Promise<void> {
  const db = getDb()
  const rows = await db.select().from(jobs).where(eq(jobs.id, jobId))
  const job = rows[0]

  if (!job) {
    pushLog(EXTERNAL_TAB, `Job ${jobId} not found in database — skipping.`)
    return
  }

  if (job.status === 'applied' || job.status === 'failed' || job.status === 'skipped') {
    pushLog(EXTERNAL_TAB, `Job ${jobId} already ${job.status} — skipping.`)
    return
  }

  const config = getCurrentConfig()

  const jobRecord: JobRecord = { id: job.id, title: job.title, company: job.company, applyUrl: job.applyUrl }
  const ctx: SubmissionContext = { reported: false }
  const browser = getExternalApplyBrowser()

  try {
    const instructions = await buildApplyInstructions(config, jobRecord)
    const agent = new Agent({
      id: 'external-apply-agent',
      name: 'External Apply Agent',
      instructions,
      model: appState.settings.model,
      browser,
      inputProcessors: [noOpBrowserContextProcessor],
      tools: {
        lookupLearnedAnswer: createLookupLearnedAnswerTool(config),
        askHumanAndRemember: createAskHumanAndRememberTool(config),
        askHumanForVerification: createAskHumanForVerificationTool(),
        reportSubmission: createReportSubmissionTool(jobRecord, browser, ctx),
      },
    })

    pushLog(EXTERNAL_TAB, `Opening application: ${job.title} @ ${job.company}`)
    await agent.generate(`Apply to this job now. Job detail/apply URL: ${jobRecord.applyUrl}`)
  } catch (err) {
    if (!ctx.reported) {
      const message = err instanceof Error ? err.message : String(err)
      await db.insert(applications).values({ id: randomUUID(), jobId: job.id, status: 'failed', error: message })
      await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
      pushLog(EXTERNAL_TAB, `Failed: ${job.title} @ ${job.company} — ${message}`)
    }
    return
  }

  if (!ctx.reported) {
    const message = 'Agent finished without reporting a result'
    await db.insert(applications).values({ id: randomUUID(), jobId: job.id, status: 'failed', error: message })
    await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
    pushLog(EXTERNAL_TAB, `Failed: ${job.title} @ ${job.company} — ${message}`)
  }
}
