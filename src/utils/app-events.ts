import { EventEmitter } from 'node:events'

export interface AppState {
  mode: string
  activeJob: { title: string; company: string } | null
  queueCounts: { search: number; easy: number; external: number }
  logs: string[]
  prompt: string | null
  promptJobId: string | null
}

class AppEvents extends EventEmitter {
  private state: AppState = {
    mode: 'idle',
    activeJob: null,
    queueCounts: { search: 0, easy: 0, external: 0 },
    logs: ['ready'],
    prompt: null,
    promptJobId: null,
  }

  getState() { return { ...this.state } }

  setState(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.state)
  }

  subscribe(cb: (s: AppState) => void) {
    this.on('change', cb)
    return () => {
      this.off('change', cb)
    }
  }

  start(mode: string) { this.setState({ mode }) }
  stop() { this.setState({ mode: 'idle', activeJob: null }) }
  answerPrompt(answer: string) {
    this.setState({ prompt: null, promptJobId: null })
    this.emit('answer', answer)
  }
}

export const appEvents = new AppEvents()
