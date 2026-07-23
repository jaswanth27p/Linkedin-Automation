import { normalize } from '../profile/answer-matching.ts'
import type { GroupedQuestion } from './review-data.ts'

export interface ReviewedPair {
  question: string
  answer: string
}

function pairKey(question: string, answer: string): string {
  return `${normalize(question)}::${answer}`
}

/**
 * Removes any variant whose (question, answer) pair already has a human
 * verdict recorded, and drops a question entirely once none of its variants
 * remain. A pair not in `reviewed` — including a new answer to a
 * previously-reviewed question — stays visible.
 */
export function filterUnreviewed(groups: GroupedQuestion[], reviewed: ReviewedPair[]): GroupedQuestion[] {
  const reviewedKeys = new Set(reviewed.map((r) => pairKey(r.question, r.answer)))

  return groups
    .map((group) => ({
      question: group.question,
      variants: group.variants.filter((v) => !reviewedKeys.has(pairKey(group.question, v.answer))),
    }))
    .filter((group) => group.variants.length > 0)
}
