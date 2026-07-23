import { describe, test, expect } from 'bun:test'
import { findLearnedAnswer } from '../../../src/profile/answer-matching.ts'

const answers = {
  'Are you willing to relocate?': 'No',
  'How many years of experience do you have with React?': '5',
}

describe('findLearnedAnswer', () => {
  test('returns null when there are no answers yet', () => {
    expect(findLearnedAnswer('Are you willing to relocate?', {})).toBeNull()
  })

  test('matches an exact (normalized) question', () => {
    expect(findLearnedAnswer('are you willing to relocate', answers)).toBe('No')
  })

  test('matches a reworded question above the similarity threshold', () => {
    expect(findLearnedAnswer('Are you willing to relocate for this role?', answers)).toBe('No')
  })

  test('does not match an unrelated question', () => {
    expect(findLearnedAnswer('What is your expected salary?', answers)).toBeNull()
  })

  // Regression: "Are you willing to relocate?" and "Are you willing to
  // travel?" share every token except the one that actually distinguishes
  // them (relocate/travel) — stopwords (are/you/willing/to) alone used to
  // clear the similarity threshold and silently reuse the relocate answer
  // for a travel question.
  test('does not match a different question that only shares stopwords', () => {
    expect(findLearnedAnswer('Are you willing to travel?', answers)).toBeNull()
  })

  test('does not match questions differing only in a unit word', () => {
    const noticeAnswers = { 'What is your notice period in weeks?': '4' }
    expect(findLearnedAnswer('What is your notice period in days?', noticeAnswers)).toBeNull()
  })
})
