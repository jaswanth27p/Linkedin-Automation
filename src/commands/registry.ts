import type { Command } from './types.ts'
import type { TabId } from '../state/types.ts'

const commands = new Map<string, Command>()

export function registerCommand(cmd: Command): void {
  commands.set(cmd.name, cmd)
}

export function getCommand(name: string): Command | undefined {
  return commands.get(name)
}

export function listCommandsForTab(tab: TabId): Command[] {
  return Array.from(commands.values()).filter((c) => c.scope === 'global' || c.scope === tab)
}

export function clearRegistryForTest(): void {
  commands.clear()
}
