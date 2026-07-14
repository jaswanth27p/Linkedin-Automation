import { ensureDataDir, createLogger, logger } from './utils/logger.ts'
import { loadConfig } from './config/loader.ts'
import { loadResume, loadProfile } from './profile/loader.ts'
import { getDb } from './db/index.ts'
import { launchBootstrapBrowser, openLoginTabs, shutdownBrowserServer } from './browser/session.ts'
import { initAppState } from './state/app-state.ts'
import { registerBuiltinCommands } from './commands/index.ts'
import { mountTui } from './tui/index.tsx'

let shuttingDown = false

async function cleanup() {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('Shutting down...')
  await shutdownBrowserServer()
}

async function main() {
  ensureDataDir()
  createLogger()

  const config = await loadConfig()

  await loadResume(config.profileFiles.resume)
  await loadProfile(config.profileFiles.profile)

  getDb()

  initAppState({
    concurrency: config.concurrency,
    model: config.model,
    irrelevantBailRatio: config.search.irrelevantBailRatio,
  })

  registerBuiltinCommands()

  await launchBootstrapBrowser('./data/browser-storage-state.json')
  await openLoginTabs('https://www.linkedin.com/login')

  process.on('SIGTERM', () => { cleanup().then(() => process.exit(0)) })

  try {
    logger.info('Starting TUI...')
    await mountTui()
    logger.info('TUI exited normally')
  } catch (err) {
    logger.error({ err }, 'TUI crashed')
    throw err
  }

  await cleanup()
}

main().catch(async (err) => {
  logger.error(err)
  console.error(err)
  await cleanup()
  process.exit(1)
})
