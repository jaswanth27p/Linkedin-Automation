import { useState, useEffect } from 'react'
import { appEvents, type AppState } from '../utils/app-events.ts'

export function useAppEvents() {
  const [state, setState] = useState<AppState>(appEvents.getState())

  useEffect(() => {
    const unsub = appEvents.subscribe(setState)
    return unsub
  }, [])

  return {
    ...state,
    start: (mode: any) => appEvents.start(mode),
    stop: () => appEvents.stop(),
    answerPrompt: (answer: string) => appEvents.answerPrompt(answer),
  }
}
