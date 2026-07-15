import type { AppConfig } from './src/config/schema.ts'

export default {
  mustCheckUrls: [
    "https://www.linkedin.com/jobs/search-results/?keywords=full%20stack%20developer",
  ],
  requirements: `
    Look for senior full-stack engineering and developer roles.
    Prefer remote or hyderabad or bangalore.
    experience bwteeen 1-2yrs.
  `,
  concurrency: 1,
  profileFiles: {
    resume: "./resume.md",
    profile: "./profile.json",
  },
  model: "opencode-go/deepseek-v4-flash",
  search: {
    irrelevantBailRatio: 0.5,
    // LinkedIn rate-limit guards. maxJobsPerRun caps job detail opens per run;
    // min/maxNavDelayMs bracket the randomized pause after each browser
    // navigation. Raise the delays / lower the cap to be gentler on the account.
    maxJobsPerRun: 25,
    minNavDelayMs: 3000,
    maxNavDelayMs: 8000,
  },
} satisfies AppConfig;
