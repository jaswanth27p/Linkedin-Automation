import { createAgent, withBrowser } from '../mastra/index.ts'
import { getDb } from '../db/index.ts'
import { applications, jobs } from '../db/schema.ts'
import { eq } from 'drizzle-orm'
import { takeScreenshot } from '../utils/screenshot.ts'
import type { ApplyJobData } from '../queues/search.queue.ts'

const easyAgent = createAgent({
  id: 'easy-apply-agent',
  name: 'Easy Apply Agent',
  instructions: `
    You apply to LinkedIn Easy Apply jobs.
    Steps:
    1. Navigate to the job page.
    2. Click the Easy Apply button.
    3. Fill every form field using the user's profile and resume.
    4. Upload the resume PDF when asked.
    5. Submit the application.
    6. Return "applied" or throw a clear error.
    If a question is not covered by the profile, throw "NEEDS_INPUT: <question>".
  `,
})

export async function runEasyApplyJob(job: ApplyJobData, profileText: string, resumePath: string) {
  const db = getDb()
  const screenshotPath = `data/screenshots/easy-${job.id}-${Date.now()}.png`

  try {
    await withBrowser(async () => {
      await easyAgent.generate(
        `Apply to ${job.title} at ${job.company} (${job.applyUrl}).\nProfile:\n${profileText}\nResume path: ${resumePath}`,
        { memory: { resource: 'user', thread: 'easy-apply-agent' } },
      )
    })

    await db.insert(applications).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      status: 'applied',
      result: 'submitted',
      screenshotPath,
    })
    await db.update(jobs).set({ status: 'applied', updatedAt: new Date() }).where(eq(jobs.id, job.id))
  } catch (err: any) {
    await takeScreenshot(screenshotPath)
    await db.insert(applications).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      status: 'failed',
      error: err.message,
      screenshotPath,
    })
    await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
    throw err
  }
}
