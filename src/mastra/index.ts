import { Mastra } from '@mastra/core'
import { Agent } from '@mastra/core/agent'
import { AgentBrowser } from '@mastra/agent-browser'
import { Memory } from '@mastra/memory'
import { LibSQLStore } from '@mastra/libsql'
import { Page } from 'playwright-core'
import { getBrowserLock } from '../utils/mutex.ts'
import { ensureDataDir } from '../utils/logger.ts'

ensureDataDir()

export const browser = new AgentBrowser({
  headless: process.env.HEADLESS !== 'false',
  storageState: './data/browser-storage-state.json',
})

export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: process.env.DATABASE_URL ?? 'file:./data/mastra.db',
  }),
})

export function createAgent({
  id,
  name,
  instructions,
  model = process.env.MASTRA_MODEL ?? 'opencode-go/kimi-k2.7-code',
}: {
  id: string
  name: string
  instructions: string
  model?: string
}) {
  return new Agent({
    id,
    name,
    model,
    instructions,
    browser,
    memory: new Memory({
      options: {
        lastMessages: 20,
      },
    }),
  })
}

export async function withBrowser<T>(fn: () => Promise<T>): Promise<T> {
  return getBrowserLock().run(fn)
}

export async function getBrowserPage(): Promise<Page> {
  // getPage is private on AgentBrowser; expose it through this project helper.
  return (browser as any).getPage()
}
