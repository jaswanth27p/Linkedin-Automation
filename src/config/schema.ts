import { z } from 'zod'

export const appConfigSchema = z.object({
  mustCheckUrls: z.array(z.string().url()),
  requirements: z.string().min(1),
  concurrency: z.number().positive().default(1),
  model: z.string().default('opencode-go/kimi-k2.7-code'),
  profileFiles: z.object({
    resume: z.string(),
    profile: z.string(),
  }),
  search: z.object({
    irrelevantBailRatio: z.number().min(0).max(1).default(0.5),
  }).default({ irrelevantBailRatio: 0.5 }),
})

export type AppConfig = z.infer<typeof appConfigSchema>
