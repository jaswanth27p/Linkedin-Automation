import { loadConfig } from './config/loader.ts'
import { getDb } from './db/index.ts'
import { loadProfileText } from './profile/loader.ts'
import { Orchestrator } from './orchestrator/index.ts'

async function main() {
  const config = await loadConfig()
  getDb()
  const profileText = await loadProfileText(config.profileFiles.profile)
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
