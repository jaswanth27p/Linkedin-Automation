import { loadConfig } from './config/loader.ts'
import { getDb } from './db/index.ts'
import { buildProfileText } from './profile/loader.ts'
import { Orchestrator, type RunMode } from './orchestrator/index.ts'
import { startTui } from './tui/index.tsx'
import { appEvents } from './utils/app-events.ts'
import { rememberFact } from './profile/memory.ts'
import { ensureDataDir, createLogger } from './utils/logger.ts'

export async function main() {
  ensureDataDir()
  createLogger()
  const config = await loadConfig()
  getDb()

  const profileText = await buildProfileText(config)
  const orchestrator = new Orchestrator({ profileText, resumePath: config.profileFiles.resume, config })

  appEvents.on('answer', async (answer: string) => {
    const { prompt: currentPrompt, promptJobId: currentJobId } = appEvents.getState()
    appEvents.setState({ prompt: null, promptJobId: null })
    if (currentPrompt && currentJobId) await rememberFact(currentPrompt, answer)
    orchestrator.emit('resume', { answer, jobId: currentJobId })
  })

  appEvents.subscribe((state) => {
    if (state.mode === 'idle') return
    if (orchestrator.isRunning) return
    orchestrator.start(state.mode as RunMode).catch(console.error)
  })

  orchestrator.on('started', (mode) => appEvents.setState({ mode }))
  orchestrator.on('stopped', () => appEvents.setState({ mode: 'idle', activeJob: null }))

  startTui()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
