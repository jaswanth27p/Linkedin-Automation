import { setNeedsInput } from './app-state.ts'
import { notify } from '../notify/notify.ts'
import type { TabId } from './types.ts'

const pending = new Map<TabId, (answer: string) => void>()

export function waitForAnswer(tab: TabId, question: string): Promise<string> {
  setNeedsInput(tab, question)
  notify({ kind: 'needs-input', tab, question })
  return new Promise((resolve) => {
    pending.set(tab, resolve)
  })
}

export function answerPrompt(tab: TabId, answer: string): boolean {
  const resolve = pending.get(tab)
  if (!resolve) return false
  pending.delete(tab)
  setNeedsInput(tab, null)
  resolve(answer)
  return true
}

export function hasPendingPrompt(tab: TabId): boolean {
  return pending.has(tab)
}
