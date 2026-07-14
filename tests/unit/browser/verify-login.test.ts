import { describe, test, expect, mock } from 'bun:test'
import { verifyLogin } from '../../../src/browser/verify-login.ts'

describe('verify-login', () => {
  test('detects logged in when on feed page', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock((_url: string) => {
      return Promise.resolve({ json: () => Promise.resolve({ url: 'https://www.linkedin.com/feed/' }) })
    }) as unknown as typeof fetch

    const result = await verifyLogin(9999)
    expect(result.linkedin).toBe(true)

    globalThis.fetch = originalFetch
  })

  test('detects not logged in when on login page', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock((_url: string) => {
      return Promise.resolve({ json: () => Promise.resolve({ url: 'https://www.linkedin.com/login' }) })
    }) as unknown as typeof fetch

    const result = await verifyLogin(9999)
    expect(result.linkedin).toBe(false)

    globalThis.fetch = originalFetch
  })

  test('returns false when fetch fails', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch

    const result = await verifyLogin(9999)
    expect(result.linkedin).toBe(false)

    globalThis.fetch = originalFetch
  })
})
