import { Mastra } from '@mastra/core'
import { PostgresStore } from '@mastra/pg'

// Central Mastra initialization. PostgresStore needs an `id` in its config
// (easy to miss). `storage` is also exported standalone in case something needs
// the store directly without going through the `mastra` instance.
export const storage = new PostgresStore({ id: 'linkedin-auto', connectionString: process.env.DATABASE_URL! })

export const mastra = new Mastra({ storage })
