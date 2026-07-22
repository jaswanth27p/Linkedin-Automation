import { normalize } from '../profile/answer-matching.ts'
import type { RecordedAnswer } from '../db/schema.ts'

export interface ApplicationAnswers {
  jobId: string
  jobTitle: string
  company: string
  answers: RecordedAnswer[]
}

export interface AnswerVariant {
  answer: string
  jobs: { jobId: string; jobTitle: string; company: string }[]
}

export interface GroupedQuestion {
  question: string
  variants: AnswerVariant[]
}

/**
 * Groups every recorded answer across all applications by normalized question
 * text, so the daily review dashboard can show one row per distinct question
 * with every distinct answer ever given to it (and which jobs got which
 * answer) — surfacing cases where the agent answered the same question
 * differently across applications.
 */
export function groupAnswersByQuestion(applications: ApplicationAnswers[]): GroupedQuestion[] {
  const byQuestion = new Map<string, { display: string; byAnswer: Map<string, AnswerVariant> }>()

  for (const app of applications) {
    for (const { question, answer } of app.answers) {
      const key = normalize(question)
      if (!key) continue

      let group = byQuestion.get(key)
      if (!group) {
        group = { display: question, byAnswer: new Map() }
        byQuestion.set(key, group)
      }

      let variant = group.byAnswer.get(answer)
      if (!variant) {
        variant = { answer, jobs: [] }
        group.byAnswer.set(answer, variant)
      }
      variant.jobs.push({ jobId: app.jobId, jobTitle: app.jobTitle, company: app.company })
    }
  }

  return Array.from(byQuestion.values())
    .map((group) => ({
      question: group.display,
      variants: Array.from(group.byAnswer.values()).sort((a, b) => b.jobs.length - a.jobs.length),
    }))
    .sort((a, b) => a.question.localeCompare(b.question))
}
