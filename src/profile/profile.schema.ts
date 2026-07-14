import { z } from 'zod'

export const profileSchema = z.object({
  contact: z.object({
    email: z.string().email(),
    phone: z.string(),
    location: z.string(),
  }),
  workAuth: z.object({
    authorized: z.boolean(),
    requiresSponsorship: z.boolean(),
  }),
  experienceYears: z.number().nonnegative(),
  salaryExpectation: z.object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
    currency: z.string(),
  }),
  links: z.object({
    linkedin: z.string(),
    github: z.string(),
    portfolio: z.string(),
  }),
  answers: z.record(z.string(), z.string()).default({}),
})

export type ProfileData = z.infer<typeof profileSchema>
