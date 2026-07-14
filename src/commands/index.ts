import { registerGlobalCommands } from './global-commands.ts'
import { registerStubCommands } from './stub-commands.ts'

export function registerBuiltinCommands(): void {
  registerGlobalCommands()
  registerStubCommands()
}
