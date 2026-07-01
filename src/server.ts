import { loadConfig } from './config/loader.ts'
import { getDb } from './db/index.ts'
import { buildProfileText } from './profile/loader.ts'
import { Orchestrator } from './orchestrator/index.ts'
import { ensureDataDir, createLogger } from './utils/logger.ts'

async function main() {
  ensureDataDir()
  createLogger()
  const config = await loadConfig()
  getDb()
  const profileText = await buildProfileText(config)
  const orchestrator = new Orchestrator({ profileText, resumePath: config.profileFiles.resume, config })
  await orchestrator.start('full-run')
  console.log('headless server running')

  process.on('SIGINT', async () => {
    await orchestrator.stop()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
