import { describe, test, expect } from 'bun:test'
import { checkLinkedInLoggedIn, checkGmailLoggedIn, type PageProbe } from '../../../src/browser/verify-login.ts'

function fakeProbe(visibleSelectors: string[]): PageProbe {
  return {
    async isVisible(selector: string) {
      return visibleSelectors.includes(selector)
    },
  }
}

describe('verify-login', () => {
  test('checkLinkedInLoggedIn true when nav profile menu is visible', async () => {
    const probe = fakeProbe(['[data-control-name="nav.settings_profile"], .global-nav__me-photo'])
    expect(await checkLinkedInLoggedIn(probe)).toBe(true)
  })

  test('checkLinkedInLoggedIn false when only the login form is visible', async () => {
    const probe = fakeProbe(['#username'])
    expect(await checkLinkedInLoggedIn(probe)).toBe(false)
  })

  test('checkGmailLoggedIn true when inbox is visible', async () => {
    const probe = fakeProbe(['[gh="tl"]'])
    expect(await checkGmailLoggedIn(probe)).toBe(true)
  })

  test('checkGmailLoggedIn false when only the Google login form is visible', async () => {
    const probe = fakeProbe(['#identifierId'])
    expect(await checkGmailLoggedIn(probe)).toBe(false)
  })
})
