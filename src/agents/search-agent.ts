import { createAgent, withBrowser } from '../mastra/index.ts'
import { generateSearchUrls } from './search-url-generator.ts'
import { enqueueJobs, type ApplyJobData } from '../queues/search.queue.ts'
import { logToTui } from '../utils/logger.ts'

const searchAgent = createAgent({
  id: 'job-searcher',
  name: 'Job Searcher',
  instructions: `
    You are a LinkedIn job search specialist.
    For each search URL you are given:
    1. Navigate to the URL.
    2. Scroll through the job list.
    3. Visit each job detail and decide if it matches the user's profile and requirements.
    4. Return a JSON array of objects: { id, title, company, location, applyUrl, applyType: "easy" | "external", sourceUrl, reason }.
       sourceUrl must be the exact search URL you were given.
    Only include jobs that are a good match. Do not apply.
  `,
})

export interface SearchJobData {
  urls: string[]
  requirements: string
  profileText: string
  postedWithinMinutes?: number
}

function isValidJob(job: Partial<ApplyJobData>): job is ApplyJobData {
  return (
    typeof job.id === 'string' &&
    typeof job.title === 'string' &&
    typeof job.company === 'string' &&
    typeof job.applyUrl === 'string' &&
    typeof job.sourceUrl === 'string' &&
    (job.applyType === 'easy' || job.applyType === 'external')
  )
}

export async function runSearchJob(data: SearchJobData) {
  const extraUrls = await generateSearchUrls(data.requirements, data.profileText)
  const allUrls = [...new Set([...data.urls, ...extraUrls])]

  logToTui(`search started: ${allUrls.length} URL(s)`)

  await withBrowser(async () => {
    for (const url of allUrls) {
      try {
        const prompt = `
Search URL: ${url}
Posted within minutes: ${data.postedWithinMinutes ?? 'any'}
Requirements:
${data.requirements}

Profile + learned facts:
${data.profileText}

Return JSON array of matching jobs. Each job must include sourceUrl set to the search URL above.`

        const res = await searchAgent.generate(prompt, {
          memory: { resource: 'user', thread: 'search-agent' },
        })

        const text = res.text.trim().replace(/^```json\n?|\n?```$/g, '')
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch (err) {
          console.error('Failed to parse search agent response for', url, err)
          continue
        }

        if (!Array.isArray(parsed)) {
          console.error('Search agent response is not an array for', url)
          continue
        }

        const jobs: ApplyJobData[] = []
        for (const item of parsed as Array<Partial<ApplyJobData>>) {
          const job = {
            ...item,
            sourceUrl: url,
          }
          if (!isValidJob(job)) {
            console.error('Skipping invalid job from', url, job)
            continue
          }
          jobs.push(job)
        }

        if (jobs.length > 0) {
          await enqueueJobs(jobs)
          logToTui(`discovered ${jobs.length} job(s) from ${url}`)
        }
      } catch (err) {
        console.error('Search failed for URL', url, err)
      }
    }
  })
}
