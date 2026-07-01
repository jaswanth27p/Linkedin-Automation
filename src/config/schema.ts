import { z } from 'zod'

export const cronSchema = z.object({
  intervalMinutes: z.number().positive(),
  postedWithinMinutes: z.number().positive().optional(),
})

export const appConfigSchema = z.object({
  mustCheckUrls: z.array(z.string().url()),
  requirements: z.string().min(1),
  cron: z.object({
    recent: cronSchema,
    full: cronSchema,
  }),
  concurrency: z.number().default(1),
  profileFiles: z.object({
    profile: z.string(),
    resume: z.string(),
  }),
  model: z.string().default('opencode-go/kimi-k2.7-code'),
})

export type AppConfig = z.infer<typeof appConfigSchema>
