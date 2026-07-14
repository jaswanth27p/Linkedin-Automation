import type { TabId } from '../state/types.ts'

export type CommandScope = 'global' | TabId

export interface CommandContext {
  args: string[]
  rawArgs: string
}

export interface Command {
  name: string
  scope: CommandScope
  description: string
  run(ctx: CommandContext): Promise<void> | void
}
