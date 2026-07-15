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
})
