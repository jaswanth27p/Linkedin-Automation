import type { Page } from 'playwright-core'
import type { BrowserManager } from 'agent-browser'

export interface PageProbe {
  isVisible(selector: string): Promise<boolean>
}

export function createPlaywrightProbe(page: Page): PageProbe {
  return {
    async isVisible(selector: string) {
      return page.locator(selector).first().isVisible().catch(() => false)
    },
  }
}

const LINKEDIN_LOGGED_IN_SELECTOR = '[data-control-name="nav.settings_profile"], .global-nav__me-photo'
const GMAIL_LOGGED_IN_SELECTOR = '[gh="tl"]'

export async function checkLinkedInLoggedIn(probe: PageProbe): Promise<boolean> {
  return probe.isVisible(LINKEDIN_LOGGED_IN_SELECTOR)
}

export async function checkGmailLoggedIn(probe: PageProbe): Promise<boolean> {
  return probe.isVisible(GMAIL_LOGGED_IN_SELECTOR)
}

export async function verifyLogin(manager: BrowserManager): Promise<{ linkedin: boolean; gmail: boolean }> {
  const pages = manager.getPages()
  const linkedinPage = pages[0]
  const gmailPage = pages[1]

  const linkedin = linkedinPage ? await checkLinkedInLoggedIn(createPlaywrightProbe(linkedinPage)) : false
  const gmail = gmailPage ? await checkGmailLoggedIn(createPlaywrightProbe(gmailPage)) : false

  return { linkedin, gmail }
}
