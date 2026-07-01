import Database from 'better-sqlite3'
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.ts'

let db: BetterSQLite3Database<typeof schema> | null = null

const initSql = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  apply_url TEXT NOT NULL,
  apply_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered',
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL,
  result TEXT,
  screenshot_path TEXT,
  error TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at INTEGER
);
`

export function getDb(url = process.env.DATABASE_URL ?? 'file:./data/app.db') {
  if (db) return db
  const isMemory = url === ':memory:' || url.startsWith('file::memory:')
  const client = isMemory ? new Database(':memory:') : new Database(url.replace('file:', ''))
  client.exec(initSql)
  db = drizzle(client, { schema })
  return db
}

export function closeDb() {
  if (db) {
    // better-sqlite3 connection closed via underlying Database
    // @ts-ignore
    db.$client.close()
    db = null
  }
}
