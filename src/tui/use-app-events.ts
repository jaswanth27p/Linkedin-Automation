import { useState, useEffect, useCallback } from 'react'
import { appEvents, type AppState } from '../utils/app-events.ts'

export function useAppEvents() {
  const [state, setState] = useState<AppState>(appEvents.getState())

  useEffect(() => {
    const unsub = appEvents.subscribe(setState)
    return unsub
  }, [])

  const start = useCallback((mode: string) => appEvents.start(mode), [])
  const stop = useCallback(() => appEvents.stop(), [])
  const answerPrompt = useCallback((answer: string) => appEvents.answerPrompt(answer), [])

  return {
    ...state,
    start,
    stop,
    answerPrompt,
  }
}
