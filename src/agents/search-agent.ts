import { createAgent, withBrowser } from '../mastra/index.ts'
import { generateSearchUrls } from './search-url-generator.ts'
import { enqueueJobs } from '../queues/search.queue.ts'

const searchAgent = createAgent({
  id: 'job-searcher',
  name: 'Job Searcher',
  instructions: `
    You are a LinkedIn job search specialist.
    For each search URL you are given:
    1. Navigate to the URL.
    2. Scroll through the job list.
    3. Visit each job detail and decide if it matches the user's profile and requirements.
    4. Return a JSON array of objects: { id, title, company, location, applyUrl, applyType: "easy" | "external", reason }.
    Only include jobs that are a good match. Do not apply.
  `,
})

export interface SearchJobData {
  urls: string[]
  requirements: string
  profileText: string
  postedWithinMinutes?: number
}

export async function runSearchJob(data: SearchJobData) {
  const extraUrls = await generateSearchUrls(data.requirements, data.profileText)
  const allUrls = [...new Set([...data.urls, ...extraUrls])]

  await withBrowser(async () => {
    for (const url of allUrls) {
      const prompt = `
Search URL: ${url}
Posted within minutes: ${data.postedWithinMinutes ?? 'any'}
Requirements:
${data.requirements}

Profile + learned facts:
${data.profileText}

Return JSON array of matching jobs.`

      const res = await searchAgent.generate(prompt, {
        memory: { resource: 'user', thread: 'search-agent' },
      })

      const text = res.text.trim().replace(/^```json\n?|\n?```$/g, '')
      let jobs: any[] = []
      try {
        jobs = JSON.parse(text)
      } catch {
        continue
      }

      await enqueueJobs(jobs)
    }
  })
}
