import { loadConfig } from './config/loader.ts'
import { getDb } from './db/index.ts'
import { loadProfileText } from './profile/loader.ts'
import { Orchestrator } from './orchestrator/index.ts'
import { startTui } from './tui/index.tsx'
import { appEvents } from './utils/app-events.ts'
import { rememberFact } from './profile/memory.ts'

export async function main() {
  const config = await loadConfig()
  getDb()

  const profileText = await loadProfileText(config.profileFiles.profile)
  const orchestrator = new Orchestrator({ profileText, resumePath: config.profileFiles.resume, config })

  let currentPrompt: string | null = null

  appEvents.on('answer', async (answer: string) => {
    const question = currentPrompt
    currentPrompt = null
    if (question) await rememberFact(question, answer)
    orchestrator.emit('resume', answer)
  })

  appEvents.subscribe((state) => {
    currentPrompt = state.prompt ?? currentPrompt
    if (state.mode === 'idle') return
    if (orchestrator.isRunning) return
    orchestrator.start(state.mode as any).catch(console.error)
  })

  orchestrator.on('started', (mode) => appEvents.setState({ mode }))
  orchestrator.on('stopped', () => appEvents.setState({ mode: 'idle', activeJob: null }))

  startTui()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
