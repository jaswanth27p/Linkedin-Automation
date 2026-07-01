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
  cron: {
    recent: { intervalMinutes: 60, postedWithinMinutes: 1440 },
    full: { intervalMinutes: 60 * 24 },
  },
  concurrency: 1,
  profileFiles: {
    profile: './profile.md',
    resume: './resume.pdf',
  },
  model: 'opencode-go/kimi-k2.7-code',
} satisfies AppConfig
