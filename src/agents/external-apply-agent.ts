import { createAgent, withBrowser } from '../mastra/index.ts'
import { getDb } from '../db/index.ts'
import { applications, jobs } from '../db/schema.ts'
import { eq } from 'drizzle-orm'
import { takeScreenshot } from '../utils/screenshot.ts'
import { NeedsInputError } from '../errors/needs-input-error.ts'
import type { ApplyJobData } from '../queues/search.queue.ts'

const externalAgent = createAgent({
  id: 'external-apply-agent',
  name: 'External Apply Agent',
  instructions: `
    You apply to jobs on external company sites linked from LinkedIn.
    Steps:
    1. Navigate to the external apply URL.
    2. Fill the application form using the user's profile and resume.
    3. Submit if possible.
    If you cannot complete the form because a required answer is missing from the profile,
    throw "NEEDS_INPUT: <exact question text>".
  `,
})

export async function runExternalApplyJob(job: ApplyJobData, profileText: string, resumePath: string) {
  const db = getDb()
  const screenshotPath = `data/screenshots/external-${job.id}-${Date.now()}.png`

  try {
    await withBrowser(async () => {
      try {
        await externalAgent.generate(
          `Apply to ${job.title} at ${job.company} via ${job.applyUrl}.\nProfile:\n${profileText}\nResume path: ${resumePath}`,
          { memory: { resource: 'user', thread: 'external-apply-agent' } }
        )
        await takeScreenshot(screenshotPath)
      } catch (err) {
        await takeScreenshot(screenshotPath)
        throw err
      }
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
    const match = err.message?.match(/NEEDS_INPUT:\s*(.+)/i)
    if (match) {
      const question = match[1].trim()
      await db.insert(applications).values({
        id: crypto.randomUUID(),
        jobId: job.id,
        status: 'needs_input',
        error: question,
        screenshotPath,
      })
      await db.update(jobs).set({ status: 'needs_input', updatedAt: new Date() }).where(eq(jobs.id, job.id))
      throw new NeedsInputError(question)
    }

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
