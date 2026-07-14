import { BrowserManager } from 'agent-browser'

let manager: BrowserManager | null = null

export async function launchBootstrapBrowser(storageStatePath: string): Promise<BrowserManager> {
  manager = new BrowserManager()
  await manager.launch({ headless: false, storageState: storageStatePath })
  return manager
}

export function getBrowserManager(): BrowserManager {
  if (!manager) throw new Error('Bootstrap browser not launched yet')
  return manager
}

export function getSharedCdpUrl(): string {
  const url = getBrowserManager().getCdpUrl()
  if (!url) throw new Error('Bootstrap browser has no CDP URL — launch() must complete first')
  return url
}

export async function openLoginTabs(linkedinUrl: string, gmailUrl: string): Promise<void> {
  const mgr = getBrowserManager()
  await mgr.navigate(linkedinUrl)
  await mgr.newTab()
  await mgr.navigate(gmailUrl)
}
