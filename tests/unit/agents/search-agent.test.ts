import { describe, test, expect } from 'bun:test'
import { computeContinueDecision } from '../../../src/agents/search-agent.ts'

describe('computeContinueDecision', () => {
  test('continues when nothing scanned yet', () => {
    expect(computeContinueDecision({ scanned: 0, skipped: 0, bailRatio: 0.5, aborted: false })).toBe(true)
  })

  test('continues while skip ratio is below the bail ratio', () => {
    expect(computeContinueDecision({ scanned: 4, skipped: 1, bailRatio: 0.5, aborted: false })).toBe(true)
  })

  test('stops once skip ratio reaches the bail ratio', () => {
    expect(computeContinueDecision({ scanned: 4, skipped: 2, bailRatio: 0.5, aborted: false })).toBe(false)
  })

  test('stops once skip ratio exceeds the bail ratio', () => {
    expect(computeContinueDecision({ scanned: 5, skipped: 4, bailRatio: 0.5, aborted: false })).toBe(false)
  })

  test('stops immediately when aborted, regardless of ratio', () => {
    expect(computeContinueDecision({ scanned: 1, skipped: 0, bailRatio: 0.5, aborted: true })).toBe(false)
  })

  test('stops once the per-run job cap is reached, even with a healthy skip ratio', () => {
    expect(
      computeContinueDecision({ scanned: 25, skipped: 0, bailRatio: 0.5, aborted: false, maxJobsPerRun: 25 }),
    ).toBe(false)
  })

  test('keeps going below the cap', () => {
    expect(
      computeContinueDecision({ scanned: 10, skipped: 1, bailRatio: 0.5, aborted: false, maxJobsPerRun: 25 }),
    ).toBe(true)
  })

  test('no cap applied when maxJobsPerRun is omitted', () => {
    expect(computeContinueDecision({ scanned: 1000, skipped: 0, bailRatio: 0.5, aborted: false })).toBe(true)
  })
})
