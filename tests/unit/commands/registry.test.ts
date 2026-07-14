import { describe, test, expect, beforeEach } from 'bun:test'
import { registerCommand, getCommand, listCommandsForTab, clearRegistryForTest } from '../../../src/commands/registry.ts'
import type { Command } from '../../../src/commands/types.ts'

beforeEach(() => {
  clearRegistryForTest()
})

describe('command registry', () => {
  test('registers and retrieves a command by name', () => {
    const cmd: Command = { name: 'help', scope: 'global', description: 'help', run: () => {} }
    registerCommand(cmd)
    expect(getCommand('help')).toBe(cmd)
  })

  test('listCommandsForTab includes global and tab-scoped commands, excludes other tabs', () => {
    registerCommand({ name: 'help', scope: 'global', description: '', run: () => {} })
    registerCommand({ name: 'search-urls', scope: 'search', description: '', run: () => {} })
    registerCommand({ name: 'process-easy-queue', scope: 'easy', description: '', run: () => {} })

    const searchCommands = listCommandsForTab('search').map((c) => c.name)
    expect(searchCommands).toContain('help')
    expect(searchCommands).toContain('search-urls')
    expect(searchCommands).not.toContain('process-easy-queue')
  })
})
