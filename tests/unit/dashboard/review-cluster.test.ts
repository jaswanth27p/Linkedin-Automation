import { describe, test, expect } from 'bun:test'
import { filterUnreviewed, type ReviewedPair } from '../../../src/dashboard/review-cluster.ts'
import type { GroupedQuestion } from '../../../src/dashboard/review-data.ts'

describe('filterUnreviewed', () => {
  test('drops a variant whose (question, answer) pair is already reviewed', () => {
    const groups: GroupedQuestion[] = [
      {
        question: 'Are you willing to relocate?',
        variants: [{ answer: 'No', jobs: [{ jobId: 'j1', jobTitle: 'Eng', company: 'Acme' }] }],
      },
    ]
    const reviewed: ReviewedPair[] = [{ question: 'Are you willing to relocate?', answer: 'No' }]

    expect(filterUnreviewed(groups, reviewed)).toEqual([])
  })

  test('drops the whole question when every variant is reviewed', () => {
    const groups: GroupedQuestion[] = [
      {
        question: 'Expected salary?',
        variants: [
          { answer: '10 LPA', jobs: [{ jobId: 'j1', jobTitle: 'Eng', company: 'Acme' }] },
          { answer: '12 LPA', jobs: [{ jobId: 'j2', jobTitle: 'Dev', company: 'Globex' }] },
        ],
      },
    ]
    const reviewed: ReviewedPair[] = [
      { question: 'Expected salary?', answer: '10 LPA' },
      { question: 'Expected salary?', answer: '12 LPA' },
    ]

    expect(filterUnreviewed(groups, reviewed)).toEqual([])
  })

  test('keeps only the unreviewed variant when a question is partially reviewed', () => {
    const groups: GroupedQuestion[] = [
      {
        question: 'Expected salary?',
        variants: [
          { answer: '10 LPA', jobs: [{ jobId: 'j1', jobTitle: 'Eng', company: 'Acme' }] },
          { answer: '12 LPA', jobs: [{ jobId: 'j2', jobTitle: 'Dev', company: 'Globex' }] },
        ],
      },
    ]
    const reviewed: ReviewedPair[] = [{ question: 'Expected salary?', answer: '10 LPA' }]

    const result = filterUnreviewed(groups, reviewed)
    expect(result).toHaveLength(1)
    expect(result[0]?.variants).toHaveLength(1)
    expect(result[0]?.variants[0]?.answer).toBe('12 LPA')
  })

  test('a new different answer to an already-reviewed question stays visible', () => {
    const groups: GroupedQuestion[] = [
      {
        question: 'Expected salary?',
        variants: [{ answer: '15 LPA', jobs: [{ jobId: 'j3', jobTitle: 'Lead', company: 'Initech' }] }],
      },
    ]
    const reviewed: ReviewedPair[] = [{ question: 'Expected salary?', answer: '10 LPA' }]

    const result = filterUnreviewed(groups, reviewed)
    expect(result).toHaveLength(1)
    expect(result[0]?.variants[0]?.answer).toBe('15 LPA')
  })

  test('matches question text case/whitespace-insensitively via normalize', () => {
    const groups: GroupedQuestion[] = [
      {
        question: 'Are you willing to relocate?',
        variants: [{ answer: 'No', jobs: [{ jobId: 'j1', jobTitle: 'Eng', company: 'Acme' }] }],
      },
    ]
    const reviewed: ReviewedPair[] = [{ question: '  ARE you willing to relocate?  ', answer: 'No' }]

    expect(filterUnreviewed(groups, reviewed)).toEqual([])
  })

  test('empty inputs return an empty array', () => {
    expect(filterUnreviewed([], [])).toEqual([])
  })
})
