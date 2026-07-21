import { describe, test, expect, beforeEach } from 'bun:test'
import { clearRegistryForTest, getCommand } from '../../../src/commands/registry.ts'
import { registerSearchCommands } from '../../../src/commands/search-commands.ts'
import { initAppState, appState } from '../../../src/state/app-state.ts'
import { setCurrentConfig } from '../../../src/config/current.ts'
import type { AppConfig } from '../../../src/config/schema.ts'

function makeConfig(): AppConfig {
  return {
    mustCheckUrls: [],
    requirements: 'placeholder',
    concurrency: 1,
    model: 'test',
    profileFiles: { resume: './resume.md', profile: './profile.json' },
    search: { maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000 },
  }
}

beforeEach(() => {
  clearRegistryForTest()
  initAppState({ concurrency: 1, model: 'test', maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000 })
  setCurrentConfig(makeConfig())
  registerSearchCommands()
})

describe('search commands', () => {
  test('registers the four search-tab commands', () => {
    expect(getCommand('search-urls')?.scope).toBe('search')
    expect(getCommand('stop-search')?.scope).toBe('search')
    expect(getCommand('auto-on')?.scope).toBe('search')
    expect(getCommand('auto-off')?.scope).toBe('search')
  })

  test('no longer registers search-describe or search-resume', () => {
    expect(getCommand('search-describe')).toBeUndefined()
    expect(getCommand('search-resume')).toBeUndefined()
  })

  test('/stop-search is a no-op with a message when nothing is running', async () => {
    await getCommand('stop-search')!.run({ args: [], rawArgs: '' })
    expect(appState.tabs.search.logs).toContain('No search is running.')
  })

  test('/auto-off is a no-op with a message when auto mode is not on', async () => {
    await getCommand('auto-off')!.run({ args: [], rawArgs: '' })
    expect(appState.tabs.search.logs).toContain('Auto mode is not on.')
  })

  test('/auto-on with no mode arg logs usage and does not start anything', async () => {
    await getCommand('auto-on')!.run({ args: [], rawArgs: '' })
    expect(appState.tabs.search.logs).toContain('Usage: /auto-on loop | /auto-on interval <duration>')
  })

  test('/auto-on with an unrecognized mode logs usage', async () => {
    await getCommand('auto-on')!.run({ args: ['bogus'], rawArgs: 'bogus' })
    expect(appState.tabs.search.logs).toContain('Usage: /auto-on loop | /auto-on interval <duration>')
  })

  test('/auto-on interval with no duration logs usage', async () => {
    await getCommand('auto-on')!.run({ args: ['interval'], rawArgs: 'interval' })
    expect(appState.tabs.search.logs).toContain('Usage: /auto-on interval <duration> (e.g. 1h, 3h, 90m)')
  })

  test('/auto-on interval with an invalid duration logs a rejection', async () => {
    await getCommand('auto-on')!.run({ args: ['interval', 'not-a-duration'], rawArgs: 'interval not-a-duration' })
    expect(appState.tabs.search.logs).toContain(
      'Invalid duration: not-a-duration. Use formats like 1h, 3h, 90m, 3h30m.',
    )
  })
})
