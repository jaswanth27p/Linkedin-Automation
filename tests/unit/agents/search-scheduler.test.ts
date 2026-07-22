import { describe, test, expect } from 'bun:test'
import { parseDurationMs, formatDuration } from '../../../src/agents/search-scheduler.ts'

describe('parseDurationMs', () => {
  test('parses hour suffix', () => {
    expect(parseDurationMs('1h')).toBe(3_600_000)
    expect(parseDurationMs('3h')).toBe(3 * 3_600_000)
  })

  test('parses minute suffix', () => {
    expect(parseDurationMs('90m')).toBe(90 * 60_000)
  })

  test('parses combined hour+minute suffix', () => {
    expect(parseDurationMs('3h30m')).toBe(3 * 3_600_000 + 30 * 60_000)
  })

  test('treats a bare number as hours', () => {
    expect(parseDurationMs('5')).toBe(5 * 3_600_000)
  })

  test('is case-insensitive', () => {
    expect(parseDurationMs('1H')).toBe(3_600_000)
  })

  test('rejects unparsable input', () => {
    expect(parseDurationMs('not a duration')).toBeNull()
    expect(parseDurationMs('')).toBeNull()
    expect(parseDurationMs('h')).toBeNull()
  })

  test('rejects non-positive durations', () => {
    expect(parseDurationMs('0')).toBeNull()
    expect(parseDurationMs('0h')).toBeNull()
  })

  test('rejects durations under the 1-minute floor', () => {
    expect(parseDurationMs('0.5m')).toBeNull()
  })
})

describe('formatDuration', () => {
  test('formats whole hours', () => {
    expect(formatDuration(3_600_000)).toBe('1h')
  })

  test('formats minutes only', () => {
    expect(formatDuration(90_000)).toBe('2m')
  })

  test('formats combined hours and minutes', () => {
    expect(formatDuration(3 * 3_600_000 + 30 * 60_000)).toBe('3h30m')
  })
})
