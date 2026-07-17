import { registerGlobalCommands } from './global-commands.ts'
import { registerSearchCommands } from './search-commands.ts'
import { registerEasyCommands } from './easy-commands.ts'
import { registerExternalCommands } from './external-commands.ts'
import { registerCareerCommands } from './career-commands.ts'

export function registerBuiltinCommands(): void {
  registerGlobalCommands()
  registerSearchCommands()
  registerEasyCommands()
  registerExternalCommands()
  registerCareerCommands()
}
