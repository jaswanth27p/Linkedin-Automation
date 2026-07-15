import { describe, test, expect } from 'bun:test'
import { computeMidPageContinueDecision, computeNextPageDecision } from '../../../src/agents/search-agent.ts'

describe('computeMidPageContinueDecision', () => {
  test('continues regardless of skip ratio', () => {
    expect(computeMidPageContinueDecision({ scanned: 3, aborted: false })).toBe(true)
    expect(computeMidPageContinueDecision({ scanned: 1, aborted: false })).toBe(true)
  })

  test('stops immediately when aborted', () => {
    expect(computeMidPageContinueDecision({ scanned: 1, aborted: true })).toBe(false)
  })

  test('stops once the per-run job cap is reached', () => {
    expect(computeMidPageContinueDecision({ scanned: 25, aborted: false, maxJobsPerRun: 25 })).toBe(false)
  })

  test('keeps going below the cap', () => {
    expect(computeMidPageContinueDecision({ scanned: 10, aborted: false, maxJobsPerRun: 25 })).toBe(true)
  })

  test('no cap applied when maxJobsPerRun is omitted', () => {
    expect(computeMidPageContinueDecision({ scanned: 1000, aborted: false })).toBe(true)
  })
})

describe('computeNextPageDecision', () => {
  test('continues when nothing scanned yet', () => {
    expect(computeNextPageDecision({ scanned: 0, skipped: 0, bailRatio: 0.5, aborted: false })).toBe(true)
  })

  test('continues while skip ratio is below the bail ratio', () => {
    expect(computeNextPageDecision({ scanned: 4, skipped: 1, bailRatio: 0.5, aborted: false })).toBe(true)
  })

  test('does not bail on an early skip below the minimum sample size', () => {
    expect(computeNextPageDecision({ scanned: 1, skipped: 1, bailRatio: 0.5, aborted: false })).toBe(true)
    expect(computeNextPageDecision({ scanned: 2, skipped: 1, bailRatio: 0.5, aborted: false })).toBe(true)
    expect(computeNextPageDecision({ scanned: 3, skipped: 3, bailRatio: 0.5, aborted: false })).toBe(true)
  })

  test('stops once skip ratio reaches the bail ratio', () => {
    expect(computeNextPageDecision({ scanned: 4, skipped: 2, bailRatio: 0.5, aborted: false })).toBe(false)
  })

  test('stops once skip ratio exceeds the bail ratio', () => {
    expect(computeNextPageDecision({ scanned: 5, skipped: 4, bailRatio: 0.5, aborted: false })).toBe(false)
  })

  test('stops immediately when aborted, regardless of ratio', () => {
    expect(computeNextPageDecision({ scanned: 1, skipped: 0, bailRatio: 0.5, aborted: true })).toBe(false)
  })

  test('stops once the per-run job cap is reached, even with a healthy skip ratio', () => {
    expect(
      computeNextPageDecision({ scanned: 25, skipped: 0, bailRatio: 0.5, aborted: false, maxJobsPerRun: 25 }),
    ).toBe(false)
  })

  test('keeps going below the cap', () => {
    expect(
      computeNextPageDecision({ scanned: 10, skipped: 1, bailRatio: 0.5, aborted: false, maxJobsPerRun: 25 }),
    ).toBe(true)
  })

  test('no cap applied when maxJobsPerRun is omitted', () => {
    expect(computeNextPageDecision({ scanned: 1000, skipped: 0, bailRatio: 0.5, aborted: false })).toBe(true)
  })
})
