import { ensureDataDir, createLogger, logger } from './utils/logger.ts'
import { loadConfig } from './config/loader.ts'
import { setCurrentConfig } from './config/current.ts'
import { loadResume, loadProfile } from './profile/loader.ts'
import { getDb, closeDb } from './db/index.ts'
import { launchBootstrapBrowser, openLoginTabs, shutdownBrowserServer } from './browser/session.ts'
import { startLoginAutoVerify, stopLoginAutoVerify } from './browser/verify-login.ts'
import { initAppState } from './state/app-state.ts'
import { registerBuiltinCommands } from './commands/index.ts'
import { stopSearchAndWait } from './agents/search-agent.ts'
import { stopEasyApplyWorker } from './queues/easy-apply-worker.ts'
import { stopExternalApplyWorker } from './queues/external-apply-worker.ts'
import { mountTui, destroyTui } from './tui/index.tsx'

let shuttingDown = false

async function cleanup() {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('Shutting down...')
  destroyTui()
  stopLoginAutoVerify()
  // Stop all three agents/processes in dependency order: the search agent
  // first (it's driving the browser directly, no queue to gate it), then
  // the two queue workers (their open Redis connections keep the process
  // alive indefinitely otherwise), and only once nothing is using the
  // browser anymore do we kill it.
  await stopSearchAndWait()
  await stopEasyApplyWorker()
  await stopExternalApplyWorker()
  await shutdownBrowserServer()
  await closeDb()
}

async function main() {
  ensureDataDir()
  createLogger()

  const config = await loadConfig()
  setCurrentConfig(config)

  await loadResume(config.profileFiles.resume)
  await loadProfile(config.profileFiles.profile)

  getDb()

  initAppState({
    concurrency: config.concurrency,
    model: config.model,
    irrelevantBailRatio: config.search.irrelevantBailRatio,
    maxJobsPerRun: config.search.maxJobsPerRun,
    minNavDelayMs: config.search.minNavDelayMs,
    maxNavDelayMs: config.search.maxNavDelayMs,
  })

  registerBuiltinCommands()

  await launchBootstrapBrowser('./data/browser-storage-state.json')
  await openLoginTabs('https://www.linkedin.com/login')

  // Restored cookies usually mean we're already logged in — poll every 5s and
  // flip the session to unlocked automatically, so the user doesn't have to run
  // /verify-login by hand. Stops itself on the first success.
  startLoginAutoVerify(5000)

  process.on('SIGTERM', () => { cleanup().then(() => process.exit(0)) })
  process.on('SIGINT', () => { cleanup().then(() => process.exit(0)) })

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
