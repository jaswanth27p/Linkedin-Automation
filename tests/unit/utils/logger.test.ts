import { describe, test, expect } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { ensureDataDir, createLogger } from '../../../src/utils/logger.ts'

describe('logger', () => {
  test('ensureDataDir creates ./data', () => {
    rmSync('./data', { recursive: true, force: true })
    ensureDataDir()
    expect(existsSync('./data')).toBe(true)
  })

  test('createLogger returns a pino logger with info/error methods', () => {
    const log = createLogger()
    expect(typeof log.info).toBe('function')
    expect(typeof log.error).toBe('function')
  })
})
