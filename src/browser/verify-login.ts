import { setSessionStatus, isUnlocked, pushLog, appState } from '../state/app-state.ts'
import { getBrowserServerPort } from './session.ts'
import { logger } from '../utils/logger.ts'

let autoVerifyTimer: ReturnType<typeof setInterval> | null = null
let ticking = false

/**
 * Poll the bootstrap browser for LinkedIn login every `intervalMs` until it
 * reports logged-in, then flip the session state and stop. Because login is
 * usually already restored from the saved cookie file at startup, this normally
 * succeeds on the very first tick — the user rarely has to run /verify-login by
 * hand anymore. Safe to call once; a second call while already polling is a
 * no-op. Stops itself on the first success (does not keep re-checking after).
 */
export function startLoginAutoVerify(intervalMs = 5000): void {
  if (autoVerifyTimer) return

  const tick = async () => {
    if (ticking) return
    if (isUnlocked()) {
      stopLoginAutoVerify()
      return
    }
    ticking = true
    try {
      let port: number
      try {
        port = getBrowserServerPort()
      } catch {
        return // browser server not up yet; try again next tick
      }
      const { linkedin } = await verifyLogin(port)
      if (linkedin) {
        setSessionStatus('linkedin', true)
        pushLog(appState.activeTab, 'Login verified automatically: LinkedIn connected.')
        logger.info('auto-verify: LinkedIn logged in')
        stopLoginAutoVerify()
      }
    } catch (err) {
      logger.warn({ err }, 'auto-verify: tick failed')
    } finally {
      ticking = false
    }
  }

  autoVerifyTimer = setInterval(tick, intervalMs)
  void tick() // check immediately, don't wait a full interval for the first one
}

export function stopLoginAutoVerify(): void {
  if (autoVerifyTimer) {
    clearInterval(autoVerifyTimer)
    autoVerifyTimer = null
  }
}

export async function verifyLogin(serverPort: number): Promise<{ linkedin: boolean }> {
  const res = await fetch(
    `http://127.0.0.1:${serverPort}/page-url?tab=0`
  ).then(r => r.json()).catch(() => ({ url: '' }))

  const pageUrl = (res.url || '').toLowerCase()
  const loggedIn =
    pageUrl.includes('linkedin.com/feed') ||
    pageUrl.includes('linkedin.com/mynetwork') ||
    pageUrl.includes('linkedin.com/jobs') ||
    pageUrl.includes('linkedin.com/messaging') ||
    pageUrl.includes('linkedin.com/notifications') ||
    (pageUrl.includes('linkedin.com') && !pageUrl.includes('/login') && !pageUrl.includes('/checkpoint'))

  return { linkedin: loggedIn }
}
