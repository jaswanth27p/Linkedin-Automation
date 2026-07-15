import { setSessionStatus, isUnlocked, pushLog, appState } from '../state/app-state.ts'
import { getBrowserServerPort } from './session.ts'
import { logger } from '../utils/logger.ts'

let autoVerifyTimer: ReturnType<typeof setInterval> | null = null
let ticking = false

/**
 * Poll the bootstrap browser for LinkedIn (tab 0) and Gmail (tab 1) login every
 * `intervalMs`. Unlock still gates on LinkedIn only — Gmail is optional, used
 * later by the external-apply agent to read OTPs/verification links, so it
 * never blocks the app. Keeps polling until BOTH are connected (not just
 * LinkedIn) — LinkedIn usually restores instantly from the saved cookie file,
 * while Gmail needs a fresh manual login every run, so stopping the timer the
 * moment LinkedIn succeeds would miss Gmail finishing seconds/minutes later.
 * The two local HTTP checks every tick are cheap, so leaving this running for
 * a while is fine; falls back to /verify-login by hand if the user never logs
 * into Gmail. Safe to call once; a second call while already polling is a
 * no-op.
 */
export function startLoginAutoVerify(intervalMs = 5000): void {
  if (autoVerifyTimer) return

  const tick = async () => {
    if (ticking) return
    if (isUnlocked() && appState.session.gmail) {
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
      const { linkedin, gmail } = await verifyLogin(port)
      if (gmail && !appState.session.gmail) {
        setSessionStatus('gmail', true)
        pushLog(appState.activeTab, 'Login verified automatically: Gmail connected.')
        logger.info('auto-verify: Gmail logged in')
      }
      if (linkedin && !appState.session.linkedin) {
        setSessionStatus('linkedin', true)
        pushLog(appState.activeTab, 'Login verified automatically: LinkedIn connected.')
        logger.info('auto-verify: LinkedIn logged in')
      }
      if (linkedin && gmail) stopLoginAutoVerify()
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

export async function verifyLogin(serverPort: number): Promise<{ linkedin: boolean; gmail: boolean }> {
  const [linkedinRes, gmailRes] = await Promise.all([
    fetch(`http://127.0.0.1:${serverPort}/page-url?tab=0`).then(r => r.json()).catch(() => ({ url: '' })),
    fetch(`http://127.0.0.1:${serverPort}/page-url?tab=1`).then(r => r.json()).catch(() => ({ url: '' })),
  ])

  const pageUrl = (linkedinRes.url || '').toLowerCase()
  const linkedin =
    pageUrl.includes('linkedin.com/feed') ||
    pageUrl.includes('linkedin.com/mynetwork') ||
    pageUrl.includes('linkedin.com/jobs') ||
    pageUrl.includes('linkedin.com/messaging') ||
    pageUrl.includes('linkedin.com/notifications') ||
    (pageUrl.includes('linkedin.com') && !pageUrl.includes('/login') && !pageUrl.includes('/checkpoint'))

  const gmailUrl = (gmailRes.url || '').toLowerCase()
  const gmail = gmailUrl.includes('mail.google.com/mail/') && !gmailUrl.includes('/signin')

  return { linkedin, gmail }
}
