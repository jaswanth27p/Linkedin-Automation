import { createAgent } from '../mastra/index.ts'

const urlAgent = createAgent({
  id: 'search-url-generator',
  name: 'Search URL Generator',
  instructions: `
    You generate LinkedIn job search URLs based on user requirements and their profile.
    Output ONLY a JSON array of absolute LinkedIn search URLs. No markdown, no explanation.
    Example: ["https://www.linkedin.com/jobs/search/?keywords=backend&location=United%20States"]
  `,
})

export async function generateSearchUrls(requirements: string, profileText: string): Promise<string[]> {
  const prompt = `
Requirements:
${requirements}

Profile:
${profileText}

Generate 1-5 LinkedIn job search URLs. Return only a JSON array.`

  const res = await urlAgent.generate(prompt, {
    memory: { resource: 'user', thread: 'search-url-generator' },
  })

  try {
    const text = res.text.trim().replace(/^```json\n?|\n?```$/g, '')
    const urls = JSON.parse(text) as string[]
    return urls.filter(u => u.startsWith('https://www.linkedin.com/jobs/search/'))
  } catch {
    return []
  }
}
