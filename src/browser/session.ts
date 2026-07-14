import { logger } from '../utils/logger.ts'

let serverPort: number | null = null
let serverProc: ReturnType<typeof Bun.spawn> | null = null
let sharedCdpUrl: string | null = null

async function ensureBrowserServer(storageStatePath: string): Promise<number> {
  if (serverPort !== null) return serverPort

  const proc = Bun.spawn(['node', 'scripts/browser-server.mjs'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      STORAGE_STATE_PATH: storageStatePath,
      LAUNCH_HEADLESS: '0',
    },
  })

  const stderrReader = proc.stderr.getReader()
  ;(async () => {
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await stderrReader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      logger.info(`[browser-server] ${text.trim()}`)
    }
  })()

  const decoder = new TextDecoder()
  const reader = proc.stdout.getReader()

  let line = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    line += decoder.decode(value, { stream: true })
    const match = line.match(/READY:(\d+)/)
    if (match) {
      serverPort = parseInt(match[1], 10)
      break
    }
  }

  serverProc = proc
  return serverPort!
}

async function httpGet(path: string): Promise<unknown> {
  const port = serverPort
  if (port === null) throw new Error('Browser server not started')
  const res = await fetch(`http://127.0.0.1:${port}${path}`)
  return res.json()
}

export async function launchBootstrapBrowser(storageStatePath: string): Promise<void> {
  await ensureBrowserServer(storageStatePath)
  // Fetch the CDP URL so Phase 2+ agents can attach to this same browser.
  try {
    const cdpData = await httpGet('/cdp-url') as { cdpUrl?: string }
    if (cdpData.cdpUrl) {
      sharedCdpUrl = cdpData.cdpUrl
      logger.info({ cdpUrl: sharedCdpUrl }, 'CDP URL captured for shared browser access')
    }
  } catch (err) {
    logger.warn({ err }, 'Could not fetch CDP URL — shared browser access via CDP will not be available')
  }
}

export function getSharedCdpUrl(): string {
  if (!sharedCdpUrl) throw new Error('CDP URL not available — browser may not have started yet, or --remote-debugging-port failed')
  return sharedCdpUrl
}

export function getBrowserServerPort(): number {
  if (serverPort === null) throw new Error('Browser server not started')
  return serverPort
}

export async function openLoginTabs(linkedinUrl: string): Promise<void> {
  await httpGet(`/navigate?url=${encodeURIComponent(linkedinUrl)}`)
}

export async function shutdownBrowserServer(): Promise<void> {
  if (serverPort !== null) {
    try {
      await fetch(`http://127.0.0.1:${serverPort}/close`)
    } catch {}
  }
  if (serverProc) {
    serverProc.kill()
    serverProc = null
  }
  serverPort = null
}
