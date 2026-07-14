import { ensureDataDir, createLogger, logger } from './utils/logger.ts'
import { loadConfig } from './config/loader.ts'
import { loadResume, loadProfile } from './profile/loader.ts'
import { getDb } from './db/index.ts'
import { launchBootstrapBrowser, openLoginTabs } from './browser/session.ts'
import { initAppState } from './state/app-state.ts'
import { registerBuiltinCommands } from './commands/index.ts'
import { mountTui } from './tui/index.tsx'

async function main() {
  ensureDataDir()
  createLogger()

  const config = await loadConfig()

  // Fail fast on bad profile data, before the browser opens.
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
  await openLoginTabs('https://www.linkedin.com/login', 'https://mail.google.com')

  await mountTui()
}

main().catch((err) => {
  logger.error(err)
  console.error(err)
  process.exit(1)
})
