import { describe, test, expect, beforeEach } from 'bun:test'
import { clearRegistryForTest, getCommand } from '../../../src/commands/registry.ts'
import { registerSearchCommands } from '../../../src/commands/search-commands.ts'
import { initAppState, appState } from '../../../src/state/app-state.ts'
import { setCurrentConfig } from '../../../src/config/current.ts'
import type { AppConfig } from '../../../src/config/schema.ts'

function makeConfig(requirements: string): AppConfig {
  return {
    mustCheckUrls: [],
    requirements,
    concurrency: 1,
    model: 'test',
    profileFiles: { resume: './resume.md', profile: './profile.json' },
    search: { irrelevantBailRatio: 0.5, maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000 },
  }
}

beforeEach(() => {
  clearRegistryForTest()
  initAppState({ concurrency: 1, model: 'test', irrelevantBailRatio: 0.5, maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000 })
  registerSearchCommands()
})

describe('search commands', () => {
  test('registers all four search-tab commands', () => {
    expect(getCommand('search-urls')?.scope).toBe('search')
    expect(getCommand('search-describe')?.scope).toBe('search')
    expect(getCommand('search-resume')?.scope).toBe('search')
    expect(getCommand('stop-search')?.scope).toBe('search')
  })

  test('/stop-search is a no-op with a message when nothing is running', async () => {
    await getCommand('stop-search')!.run({ args: [], rawArgs: '' })
    expect(appState.tabs.search.logs).toContain('No search is running.')
  })

  test('/search-describe with no text and empty config requirements does not run', async () => {
    setCurrentConfig(makeConfig('   '))
    await getCommand('search-describe')!.run({ args: [], rawArgs: '' })
    expect(appState.tabs.search.logs).toContain(
      'No description given and no requirements set in linkedin-auto.config.ts.',
    )
  })
})
