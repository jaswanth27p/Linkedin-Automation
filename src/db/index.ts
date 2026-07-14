import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.ts'

let _db: NodePgDatabase<typeof schema> | null = null
let _pool: Pool | null = null

export function getDb(): NodePgDatabase<typeof schema> {
  if (!_db) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL })
    _db = drizzle(_pool, { schema })
  }
  return _db
}

export async function closeDb(): Promise<void> {
  await _pool?.end()
  _db = null
  _pool = null
}
