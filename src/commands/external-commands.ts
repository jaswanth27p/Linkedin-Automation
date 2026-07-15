import { registerCommand } from './registry.ts'
import { pushLog } from '../state/app-state.ts'
import {
  startExternalApplyWorker,
  stopExternalApplyWorker,
  isExternalApplyWorkerRunning,
} from '../queues/external-apply-worker.ts'

const EXTERNAL_TAB = 'external'

export function registerExternalCommands(): void {
  registerCommand({
    name: 'process-external-queue',
    scope: 'external',
    description: 'Start processing the external-apply queue',
    run: () => {
      if (isExternalApplyWorkerRunning()) {
        pushLog(EXTERNAL_TAB, 'External Apply worker is already running. Use /stop-external-queue first.')
        return
      }
      startExternalApplyWorker()
    },
  })

  registerCommand({
    name: 'stop-external-queue',
    scope: 'external',
    description: 'Stop processing the external-apply queue',
    run: async () => {
      if (!isExternalApplyWorkerRunning()) {
        pushLog(EXTERNAL_TAB, 'External Apply worker is not running.')
        return
      }
      await stopExternalApplyWorker()
    },
  })
}
