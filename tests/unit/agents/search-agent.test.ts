import { describe, test, expect } from 'bun:test'
import { computeMidPageContinueDecision, buildScanInstructions } from '../../../src/agents/search-agent.ts'

describe('computeMidPageContinueDecision', () => {
  test('continues when nothing has been scanned yet', () => {
    expect(computeMidPageContinueDecision({ scanned: 0, aborted: false })).toBe(true)
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

describe('buildScanInstructions', () => {
  test('describes the dedupe-first, no-judgment flow', async () => {
    const instructions = await buildScanInstructions()
    expect(instructions).toContain('There is no relevance judgment to make')
    expect(instructions).toContain('check-already-seen')
    expect(instructions).toContain('report-job')
    expect(instructions).toContain('interactiveOnly: true')
  })
})
