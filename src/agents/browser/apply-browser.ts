import { AgentBrowser } from '@mastra/agent-browser'

export class ApplyBrowser extends AgentBrowser {
  /**
   * Uploads a local file to a file-input field on the current page. Playwright's
   * setInputFiles works even on visually hidden inputs — most ATS forms style the
   * real <input type="file"> invisible and show a styled button instead — so no
   * click-to-open-a-native-picker step is needed; this sets the file directly.
   */
  async uploadFile(filePath: string, labelHint?: string): Promise<{ ok: boolean; error?: string }> {
    const page = await this.getActivePage()
    if (!page) return { ok: false, error: 'no active page' }

    const inputs = page.locator('input[type="file"]')
    const count = await inputs.count()
    if (count === 0) return { ok: false, error: 'no file input found on page' }

    let target = inputs.first()
    if (labelHint) {
      const hint = labelHint.toLowerCase()
      for (let i = 0; i < count; i++) {
        const candidate = inputs.nth(i)
        const matches = await candidate
          .evaluate((el, needle) => {
            const label = el.closest('label')?.textContent ?? el.closest('div')?.textContent ?? ''
            return label.toLowerCase().includes(needle)
          }, hint)
          .catch(() => false)
        if (matches) {
          target = candidate
          break
        }
      }
    }

    try {
      await target.setInputFiles(filePath, { timeout: 10_000 })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
