import { describe, test, expect, beforeEach } from 'bun:test'
import { clearRegistryForTest, getCommand } from '../../../src/commands/registry.ts'
import { registerExternalCommands } from '../../../src/commands/external-commands.ts'
import { initAppState, appState } from '../../../src/state/app-state.ts'

beforeEach(() => {
  clearRegistryForTest()
  initAppState({ concurrency: 1, model: 'test', irrelevantBailRatio: 0.5, maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000 })
  registerExternalCommands()
})

describe('external commands', () => {
  test('registers both external-tab commands', () => {
    expect(getCommand('process-external-queue')?.scope).toBe('external')
    expect(getCommand('stop-external-queue')?.scope).toBe('external')
  })

  test('/stop-external-queue is a no-op with a message when nothing is running', async () => {
    await getCommand('stop-external-queue')!.run({ args: [], rawArgs: '' })
    expect(appState.tabs.external.logs).toContain('External Apply worker is not running.')
  })
})
