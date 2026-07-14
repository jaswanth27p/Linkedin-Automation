import { createServer } from 'node:http'
import { chromium } from 'playwright-core'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const PORT = parseInt(process.env.BROWSER_SERVER_PORT || '0', 10)
const HEADLESS = process.env.LAUNCH_HEADLESS === '1'
const STORAGE_STATE = process.env.STORAGE_STATE_PATH || ''

const userDataDir = join(tmpdir(), `linkedin-auto-${Date.now()}`)
process.stderr.write(`[browser-server] userDataDir: ${userDataDir}\n`)

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: HEADLESS,
  args: ['--no-sandbox', '--remote-debugging-port=0'],
  noDefaultViewport: true,
})

process.stderr.write(`[browser-server] browser launched\n`)

// Find the CDP port that Chromium assigned (from --remote-debugging-port=0).
// Chromium writes the port to <userDataDir>/DevToolsActivePort after starting.
let cdpPort = null
// DevToolsActivePort is written asynchronously — poll for up to 5s.
for (let attempt = 0; attempt < 50; attempt++) {
  try {
    const portPath = join(userDataDir, 'DevToolsActivePort')
    const content = readFileSync(portPath, 'utf-8')
    const match = content.match(/^\d+/m)
    if (match) {
      cdpPort = parseInt(match[0], 10)
      process.stderr.write(`[browser-server] CDP port: ${cdpPort}\n`)
      break
    }
  } catch {}
  await new Promise(r => setTimeout(r, 100))
}
if (!cdpPort) {
  process.stderr.write(`[browser-server] WARNING: could not find DevToolsActivePort — CDP URL will not be available\n`)
}

if (STORAGE_STATE && existsSync(STORAGE_STATE)) {
  try {
    const state = JSON.parse(readFileSync(STORAGE_STATE, 'utf8'))
    await browser.addCookies(state.cookies || [])
    process.stderr.write(`[browser-server] loaded ${state.cookies?.length || 0} cookies\n`)
  } catch(e) {
    process.stderr.write(`[browser-server] cookie load error: ${e.message}\n`)
  }
}

function saveState() {
  if (!STORAGE_STATE) return
  try {
    mkdirSync(dirname(STORAGE_STATE), { recursive: true })
    const cookies = browser.cookies()
    writeFileSync(STORAGE_STATE, JSON.stringify({ cookies }))
  } catch {}
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`)

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true }))
    }

    if (url.pathname === '/navigate') {
      const target = url.searchParams.get('url')
      if (!target) { res.writeHead(400); return res.end('missing url') }
      const pages = browser.pages()
      const page = pages.length > 0 ? pages[0] : await browser.newPage()
      await page.goto(target, { waitUntil: 'domcontentloaded' })
      process.stderr.write(`[browser-server] navigated to: ${page.url()}\n`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, url: page.url() }))
    }

    if (url.pathname === '/newtab') {
      const target = url.searchParams.get('url') || 'about:blank'
      const page = await browser.newPage()
      await page.goto(target, { waitUntil: 'domcontentloaded' })
      process.stderr.write(`[browser-server] new tab: ${page.url()}\n`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true }))
    }

    if (url.pathname === '/state') {
      saveState()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true }))
    }

    if (url.pathname === '/check-selector') {
      const tabIndex = parseInt(url.searchParams.get('tab') || '0', 10)
      const selector = url.searchParams.get('selector') || ''
      if (!selector) { res.writeHead(400); return res.end('missing selector') }
      const pages = browser.pages()
      if (tabIndex >= pages.length) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ visible: false }))
      }
      const page = pages[tabIndex]
      const visible = await page.locator(selector).first().isVisible().catch(() => false)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ visible }))
    }

    if (url.pathname === '/page-url') {
      const tabIndex = parseInt(url.searchParams.get('tab') || '0', 10)
      const pages = browser.pages()
      if (tabIndex >= pages.length) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ url: '' }))
      }
      const pageUrl = pages[tabIndex].url()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ url: pageUrl }))
    }

    if (url.pathname === '/cdp-url') {
      if (!cdpPort) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: 'CDP port not available. Ensure --remote-debugging-port was passed to Chromium.' }))
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ cdpUrl: `http://127.0.0.1:${cdpPort}` }))
    }

    if (url.pathname === '/close') {
      process.stderr.write(`[browser-server] received /close\n`)
      saveState()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      await browser.close()
      process.stderr.write(`[browser-server] browser closed, exiting\n`)
      process.exit(0)
      return
    }

    res.writeHead(404)
    res.end('not found')
  } catch (e) {
    process.stderr.write(`[browser-server] request error: ${e.message}\n`)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: e.message }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address()
  const port = typeof addr === 'object' ? addr.port : PORT
  process.stderr.write(`[browser-server] listening on ${port}\n`)
  process.stdout.write(`READY:${port}\n`)
})

process.on('SIGINT', async () => {
  process.stderr.write(`[browser-server] SIGINT\n`)
  saveState()
  await browser.close()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  process.stderr.write(`[browser-server] SIGTERM\n`)
  saveState()
  await browser.close()
  process.exit(0)
})

process.on('exit', () => {
  process.stderr.write(`[browser-server] process exiting\n`)
})
