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

import { parseClusterResponse } from '../../../src/dashboard/review-cluster.ts'

describe('parseClusterResponse', () => {
  const inputs = ['Do you require visa sponsorship?', 'Will you need sponsorship to work in the US?', 'Expected salary?']

  test('parses a well-formed JSON response', () => {
    const text = JSON.stringify([
      {
        canonicalQuestion: 'Do you require visa sponsorship?',
        memberQuestions: ['Do you require visa sponsorship?', 'Will you need sponsorship to work in the US?'],
      },
      { canonicalQuestion: 'Expected salary?', memberQuestions: ['Expected salary?'] },
    ])

    const clusters = parseClusterResponse(text, inputs)
    expect(clusters).toHaveLength(2)
    expect(clusters[0]?.memberQuestions).toHaveLength(2)
  })

  test('strips a markdown code fence around the JSON', () => {
    const text = '```json\n' + JSON.stringify([{ canonicalQuestion: 'Expected salary?', memberQuestions: inputs }]) + '\n```'

    const clusters = parseClusterResponse(text, inputs)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.memberQuestions).toHaveLength(3)
  })

  test('adds a singleton cluster for any input question the model dropped', () => {
    const text = JSON.stringify([{ canonicalQuestion: 'Expected salary?', memberQuestions: ['Expected salary?'] }])

    const clusters = parseClusterResponse(text, inputs)
    const allMembers = clusters.flatMap((c) => c.memberQuestions)
    expect(allMembers).toHaveLength(3)
    expect(allMembers).toContain('Do you require visa sponsorship?')
    expect(allMembers).toContain('Will you need sponsorship to work in the US?')
  })

  test('matches member questions to inputs case/whitespace-insensitively via normalize', () => {
    const text = JSON.stringify([{ canonicalQuestion: 'Expected salary?', memberQuestions: ['  EXPECTED salary?  '] }])

    const clusters = parseClusterResponse(text, ['Expected salary?'])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.memberQuestions).toEqual(['Expected salary?'])
  })

  test('throws on unparseable JSON', () => {
    expect(() => parseClusterResponse('not json at all', inputs)).toThrow()
  })

  test('empty input list returns an empty array without calling the model', () => {
    expect(parseClusterResponse('[]', [])).toEqual([])
  })
})
