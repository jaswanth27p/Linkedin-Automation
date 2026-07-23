import { z } from 'zod'

export const appConfigSchema = z.object({
  mustCheckUrls: z.array(z.url()),
  /** Free text describing what to look for — consumed ONLY by the career-page
   * scan agent (src/agents/career-scan-agent.ts). The LinkedIn search agent no
   * longer judges relevance: a configured mustCheckUrls entry is trusted as
   * already-filtered by its own LinkedIn search params. */
  requirements: z.string().min(1),
  concurrency: z.number().positive().default(1),
  model: z.string().default('opencode-go/deepseek-v4-flash'),
  notifySummaryIntervalMinutes: z.number().int().positive().default(30),
  profileFiles: z.object({
    resume: z.string(),
    profile: z.string(),
  }),
  search: z.object({
    // Rate-limit guards to avoid tripping LinkedIn's automation defenses:
    // - maxJobsPerRun caps how many job detail pages a single scan run opens.
    // - min/maxNavDelayMs bracket a randomized human-like pause inserted (in
    //   code, not left to the model) after every browser navigation.
    maxJobsPerRun: z.number().int().positive().default(25),
    minNavDelayMs: z.number().int().min(0).default(3000),
    maxNavDelayMs: z.number().int().min(0).default(8000),
    /** Minimum pause between full /auto-on loop cycles (re-scanning the same
     * configured URLs). Without this, loop mode reopens the same search
     * results back-to-back nonstop — a real LinkedIn rate-limit/ban risk,
     * unlike /auto-on interval which already waits the full interval. */
    loopCooldownMs: z.number().int().min(60_000).default(300_000),
  }).default({ maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000, loopCooldownMs: 300_000 }),
})

export type AppConfig = z.infer<typeof appConfigSchema>
