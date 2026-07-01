import { Mastra } from '@mastra/core'
import { Agent } from '@mastra/core/agent'
import { AgentBrowser } from '@mastra/agent-browser'
import { Memory } from '@mastra/memory'
import { LibSQLStore } from '@mastra/libsql'
import { getBrowserLock } from '../utils/mutex.ts'

export const browser = new AgentBrowser({
  headless: process.env.HEADLESS !== 'false',
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
