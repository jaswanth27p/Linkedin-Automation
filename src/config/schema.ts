import { z } from 'zod'

export const appConfigSchema = z.object({
  mustCheckUrls: z.array(z.url()),
  requirements: z.string().min(1),
  concurrency: z.number().positive().default(1),
  model: z.string().default('opencode-go/deepseek-v4-flash'),
  profileFiles: z.object({
    resume: z.string(),
    profile: z.string(),
  }),
  search: z.object({
    irrelevantBailRatio: z.number().min(0).max(1).default(0.5),
    // Rate-limit guards to avoid tripping LinkedIn's automation defenses:
    // - maxJobsPerRun caps how many job detail pages a single scan run opens.
    // - min/maxNavDelayMs bracket a randomized human-like pause inserted (in
    //   code, not left to the model) after every browser navigation.
    maxJobsPerRun: z.number().int().positive().default(25),
    minNavDelayMs: z.number().int().min(0).default(3000),
    maxNavDelayMs: z.number().int().min(0).default(8000),
  }).default({ irrelevantBailRatio: 0.5, maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000 }),
})

export type AppConfig = z.infer<typeof appConfigSchema>
