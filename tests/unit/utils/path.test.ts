import { test, expect } from 'vitest'
import { sanitizeId } from '../../../src/utils/path.ts'

test('sanitizeId keeps safe characters', () => {
  expect(sanitizeId('job-123_abc')).toBe('job-123_abc')
})

test('sanitizeId replaces unsafe characters with underscore', () => {
  expect(sanitizeId('job:123/abc?x=1')).toBe('job_123_abc_x_1')
})

test('sanitizeId handles empty string', () => {
  expect(sanitizeId('')).toBe('')
})
