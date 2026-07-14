import { chromium } from 'playwright-core'
import { createInterface } from 'node:readline'

const HEADLESS = process.env.LAUNCH_HEADLESS === '1'
const CDP_PORT = parseInt(process.env.LAUNCH_CDP_PORT || '9223', 10)
const STORAGE_STATE = process.env.LAUNCH_STORAGE_STATE || ''

const server = await chromium.launchServer({
  headless: HEADLESS,
  port: CDP_PORT,
  args: ['--no-sandbox'],
})

const wsEndpoint = server.wsEndpoint()
process.stdout.write(`CDP:${wsEndpoint}\n`)

if (STORAGE_STATE) {
  try {
    const { readFileSync, existsSync } = await import('node:fs')
    if (existsSync(STORAGE_STATE)) {
      const browser = await chromium.connectOverCDP(wsEndpoint)
      const context = await browser.newContext()
      const state = JSON.parse(readFileSync(STORAGE_STATE, 'utf8'))
      await context.addCookies(state.cookies || [])
      await context.close()
    }
  } catch (e) {
    console.error('[launch-browser] Failed to load storage state:', e.message)
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line === 'CLOSE') {
    server.close().then(() => process.exit(0))
  }
})

process.on('SIGINT', async () => {
  await server.close()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await server.close()
  process.exit(0)
})
