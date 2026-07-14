import { registerCommand } from './registry.ts'
import { pushLog } from '../state/app-state.ts'
import type { TabId } from '../state/types.ts'

function stub(name: string, scope: TabId, phase: number, description: string) {
  registerCommand({
    name,
    scope,
    description,
    run: () => {
      pushLog(scope, `/${name} is not implemented yet — arrives in Phase ${phase}.`)
    },
  })
}

export function registerStubCommands(): void {
  stub('search-urls', 'search', 2, 'Run configured LinkedIn search URLs')
  stub('search-describe', 'search', 2, 'Describe the jobs you want in free text')
  stub('search-resume', 'search', 2, 'Infer search filters from resume.md')
  stub('process-easy-queue', 'easy', 3, 'Start processing the Easy Apply queue')
  stub('process-external-queue', 'external', 4, 'Start processing the external-apply queue')
}
