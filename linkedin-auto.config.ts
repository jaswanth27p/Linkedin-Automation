import type { AppConfig } from './src/config/schema.ts'

export default {
  mustCheckUrls: [
    "https://www.linkedin.com/jobs/search-results/? keywords=entry-level%20typescript%20javascript%20node%20express%20react%20next.js%20nest.js%20posted%20in%20the%20past%2024%20hours&origin=JOB_SEARCH_PAGE_LOCATION_AUTOCOMPLETE&geoId=105556991",
    "https://www.linkedin.com/jobs/search-results/?keywords=entry-level software enginner developer full stack posted in the past 24 hours&origin=JOB_SEARCH_PAGE_LOCATION_AUTOCOMPLETE&geoId=105556991",
    "https://www.linkedin.com/jobs/search-results/? keywords=entry-level%20typescript%20javascript%20node%20express%20react%20next.js%20nest.js%20posted%20in%20the%20past%2024%20hours&origin=JOB_SEARCH_PAGE_LOCATION_AUTOCOMPLETE&geoId=105214831",
    "https://www.linkedin.com/jobs/search-results/?keywords=entry-level software enginner developer full stack posted in the past 24 hours&origin=JOB_SEARCH_PAGE_LOCATION_AUTOCOMPLETE&geoId=105214831",
    "https://www.linkedin.com/jobs/search-results/? keywords=entry-level%20typescript%20javascript%20node%20express%20react%20next.js%20nest.js%20posted%20in%20the%20past%2024%20hours%20remote&origin=JOB_SEARCH_PAGE_LOCATION_AUTOCOMPLETE&geoId=102713980",
    "https://www.linkedin.com/jobs/search-results/?keywords=entry-level software enginner developer full stack posted in the past 24 hours remote&origin=JOB_SEARCH_PAGE_LOCATION_AUTOCOMPLETE&geoId=102713980",
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
  model: "opencode-go/deepseek-v4-pro",
  notifySummaryIntervalMinutes: 30,
  search: {
    // LinkedIn rate-limit guards. maxJobsPerRun caps job detail opens per run;
    // min/maxNavDelayMs bracket the randomized pause after each browser
    // navigation. Raise the delays / lower the cap to be gentler on the account.
    maxJobsPerRun: 50,
    minNavDelayMs: 3000,
    maxNavDelayMs: 8000,
    loopCooldownMs: 300000,
  },
} satisfies AppConfig;
