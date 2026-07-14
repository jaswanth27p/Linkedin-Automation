export type TabId = 'search' | 'easy' | 'external'
export type AgentStatus = 'idle' | 'running' | 'needs_input'

export interface TabState {
  status: AgentStatus
  step: string | null
  logs: string[]
  needsInputQuestion: string | null
}

export interface SessionStatus {
  linkedin: boolean
  gmail: boolean
}

export interface Settings {
  concurrency: number
  model: string
  irrelevantBailRatio: number
}

export interface AppState {
  session: SessionStatus
  activeTab: TabId
  tabs: Record<TabId, TabState>
  settings: Settings
}

export const TAB_IDS: TabId[] = ['search', 'easy', 'external']

export const MAX_LOGS_PER_TAB = 500
