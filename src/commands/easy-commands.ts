import { registerCommand } from './registry.ts'
import { pushLog } from '../state/app-state.ts'
import { startEasyApplyWorker, stopEasyApplyWorker, isEasyApplyWorkerRunning } from '../queues/easy-apply-worker.ts'

const EASY_TAB = 'easy'

export function registerEasyCommands(): void {
  registerCommand({
    name: 'process-easy-queue',
    scope: 'easy',
    description: 'Start processing the Easy Apply queue',
    run: () => {
      if (isEasyApplyWorkerRunning()) {
        pushLog(EASY_TAB, 'Easy Apply worker is already running. Use /stop-easy-queue first.')
        return
      }
      startEasyApplyWorker()
    },
  })

  registerCommand({
    name: 'stop-easy-queue',
    scope: 'easy',
    description: 'Stop processing the Easy Apply queue',
    run: async () => {
      if (!isEasyApplyWorkerRunning()) {
        pushLog(EASY_TAB, 'Easy Apply worker is not running.')
        return
      }
      await stopEasyApplyWorker()
    },
  })
}
