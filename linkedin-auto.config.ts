import type { AppConfig } from './src/config/schema.ts'

export default {
  mustCheckUrls: [
    'https://www.linkedin.com/jobs/search/?f_TPR=r86400&keywords=software%20engineer',
  ],
  requirements: `
    Look for senior backend / full-stack engineering roles.
    Prefer remote or hybrid in the US.
    Avoid roles requiring more than 8 years of experience.
  `,
  concurrency: 1,
  profileFiles: {
    resume: './resume.md',
    profile: './profile.json',
  },
  model: 'opencode-go/kimi-k2.7-code',
  search: {
    irrelevantBailRatio: 0.5,
  },
} satisfies AppConfig
