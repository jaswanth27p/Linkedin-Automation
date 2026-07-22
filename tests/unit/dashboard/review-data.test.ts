import { describe, test, expect } from 'bun:test'
import { groupAnswersByQuestion, type ApplicationAnswers } from '../../../src/dashboard/review-data.ts'

describe('groupAnswersByQuestion', () => {
  test('groups identical (normalized) questions together', () => {
    const apps: ApplicationAnswers[] = [
      {
        jobId: 'job-1',
        jobTitle: 'Engineer',
        company: 'Acme',
        answers: [{ question: 'Are you willing to relocate?', answer: 'No', source: 'profile' }],
      },
      {
        jobId: 'job-2',
        jobTitle: 'Developer',
        company: 'Globex',
        answers: [{ question: 'are you willing to relocate', answer: 'No', source: 'profile' }],
      },
    ]

    const grouped = groupAnswersByQuestion(apps)
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.variants).toHaveLength(1)
    expect(grouped[0]?.variants[0]?.jobs).toHaveLength(2)
  })

  test('lists multiple distinct answers to the same question separately', () => {
    const apps: ApplicationAnswers[] = [
      {
        jobId: 'job-1',
        jobTitle: 'Engineer',
        company: 'Acme',
        answers: [{ question: 'Expected salary?', answer: '10 LPA', source: 'human' }],
      },
      {
        jobId: 'job-2',
        jobTitle: 'Developer',
        company: 'Globex',
        answers: [{ question: 'Expected salary?', answer: '12 LPA', source: 'human' }],
      },
    ]

    const grouped = groupAnswersByQuestion(apps)
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.variants).toHaveLength(2)
    const answerTexts = grouped[0]?.variants.map((v) => v.answer).sort()
    expect(answerTexts).toEqual(['10 LPA', '12 LPA'])
  })

  test('sorts questions alphabetically and variants by frequency', () => {
    const apps: ApplicationAnswers[] = [
      { jobId: 'j1', jobTitle: 'A', company: 'A', answers: [{ question: 'Zebra question?', answer: 'x', source: 'profile' }] },
      { jobId: 'j2', jobTitle: 'B', company: 'B', answers: [{ question: 'Apple question?', answer: 'y', source: 'profile' }] },
      { jobId: 'j3', jobTitle: 'C', company: 'C', answers: [{ question: 'Apple question?', answer: 'y', source: 'profile' }] },
      { jobId: 'j4', jobTitle: 'D', company: 'D', answers: [{ question: 'Apple question?', answer: 'z', source: 'profile' }] },
    ]

    const grouped = groupAnswersByQuestion(apps)
    expect(grouped.map((g) => g.question)).toEqual(['Apple question?', 'Zebra question?'])
    expect(grouped[0]?.variants[0]?.answer).toBe('y')
  })

  test('returns an empty array for no applications', () => {
    expect(groupAnswersByQuestion([])).toEqual([])
  })
})
