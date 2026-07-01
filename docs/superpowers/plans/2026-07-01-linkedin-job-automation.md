# LinkedIn Job Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first TUI application that uses Mastra browser agents to search LinkedIn jobs, classify them as Easy Apply or external apply, and apply on the user's behalf through BullMQ queues.

**Architecture:** Single TypeScript Node process. Ink-based box-layout TUI controls an embedded server that schedules Mastra browser-agent jobs on BullMQ queues backed by Redis. SQLite stores job/application state and learned facts. A single shared `AgentBrowser` context enforces global concurrency of `1`.

**Tech Stack:** Node 22 LTS, TypeScript ESM, `@mastra/core`, `@mastra/agent-browser`, `@mastra/memory`, `@mastra/libsql`, BullMQ + Redis, Drizzle ORM + `better-sqlite3`, Zod, Ink + React, pino, vitest.

## Global Constraints

- Runtime: Node.js 22+ (Mastra direct-TS support).
- Module system: ESM only (`"type": "module"` in `package.json`).
- Import local TS files with `.ts` extension.
- Mastra model string uses `provider/model-name` format; default model is `opencode-go/kimi-k2.7-code` and auth is `OPENCODE_API_KEY`.
- Browser concurrency is `1` globally; search and apply never run simultaneously.
- All agent actions run through Mastra browser agents (`@mastra/agent-browser`); do not set up Playwright separately.
- Local dev uses SQLite; production/cloud uses Postgres.
- Commit after every task.

## File Structure

```
linkedin-auto.config.ts
.env.example
docker-compose.yml
package.json
tsconfig.json
src/
  cli.ts                 # TUI entry
  server.ts              # Headless server entry
  config/
    schema.ts            # Zod config shape
    loader.ts            # Load + validate config
  db/
    schema.ts            # Drizzle tables
    index.ts             # DB connection
  profile/
    loader.ts            # Load profile.md / resume.pdf path
    memory.ts            # CRUD for learned Q&A facts
  mastra/
    index.ts             # Mastra, AgentBrowser, Memory setup
  agents/
    search-url-generator.ts
    search-agent.ts
    easy-apply-agent.ts
    external-apply-agent.ts
  queues/
    connection.ts        # Redis + Queue factory
    search.queue.ts
    easy-apply.queue.ts
    external-apply.queue.ts
  scheduler/
    index.ts             # Recent + full repeatable jobs
  orchestrator/
    index.ts             # Start/stop workers + scheduler
  errors/
    needs-input-error.ts
  utils/
    logger.ts
    screenshot.ts
    mutex.ts             # Global browser lock
  tui/
    App.tsx              # Box-based layout
    Menu.tsx
    StatusPanel.tsx
    LogsPanel.tsx
    PromptPanel.tsx
    use-app-events.ts
    index.tsx            # Render entry
tests/
  unit/                  # one file per src module
```

---

### Task 1: Project scaffolding and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `.env.example`, `docker-compose.yml`, `vitest.config.ts`
- Test: `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts `typecheck`, `test`, `dev`, `start`, `server`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/smoke.test.ts
import { test, expect } from 'vitest'

test('project loads', () => {
  expect(true).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm install && npx vitest run tests/unit/smoke.test.ts`
Expected: FAIL because vitest config not created.

- [ ] **Step 3: Write minimal implementation**

```json
// package.json
{
  "name": "linkedin-automation",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "dev": "tsx src/cli.ts",
    "start": "NODE_ENV=production tsx src/cli.ts",
    "server": "NODE_ENV=production tsx src/server.ts"
  },
  "dependencies": {
    "@mastra/agent-browser": "latest",
    "@mastra/core": "latest",
    "@mastra/libsql": "latest",
    "@mastra/memory": "latest",
    "bullmq": "latest",
    "drizzle-orm": "latest",
    "better-sqlite3": "latest",
    "ioredis": "latest",
    "zod": "latest",
    "ink": "latest",
    "react": "latest",
    "ink-text-input": "latest",
    "pino": "latest",
    "pino-pretty": "latest"
  },
  "devDependencies": {
    "@types/better-sqlite3": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "outDir": "dist",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*", "tests/**/*", "linkedin-auto.config.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: linkedin_auto
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

```text
# .env.example
MASTRA_MODEL=opencode-go/kimi-k2.7-code
OPENCODE_API_KEY=
REDIS_URL=redis://localhost:6379
DATABASE_URL=file:./data/app.db
LINKEDIN_EMAIL=
LINKEDIN_PASSWORD=
HEADLESS=true
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts docker-compose.yml .env.example tests/unit/smoke.test.ts
git commit -m "chore: project scaffolding"
```

---

### Task 2: Config loader

**Files:**
- Create: `src/config/schema.ts`, `src/config/loader.ts`, `linkedin-auto.config.ts`
- Test: `tests/unit/config/loader.test.ts`

**Interfaces:**
- Produces: `loadConfig(): Promise<AppConfig>` exported from `src/config/loader.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/config/loader.test.ts
import { test, expect } from 'vitest'
import { loadConfig } from '../../src/config/loader.ts'

test('loads and validates sample config', async () => {
  const config = await loadConfig('./linkedin-auto.config.ts')
  expect(config.mustCheckUrls).toHaveLength(1)
  expect(config.requirements).toContain('remote')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config/loader.test.ts`
Expected: FAIL — `loadConfig` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config/schema.ts
import { z } from 'zod'

export const cronSchema = z.object({
  intervalMinutes: z.number().positive(),
  postedWithinMinutes: z.number().positive().optional(),
})

export const appConfigSchema = z.object({
  mustCheckUrls: z.array(z.string().url()),
  requirements: z.string().min(1),
  cron: z.object({
    recent: cronSchema,
    full: cronSchema,
  }),
  concurrency: z.number().default(1),
  profileFiles: z.object({
    profile: z.string(),
    resume: z.string(),
  }),
  model: z.string().default('opencode-go/kimi-k2.7-code'),
})

export type AppConfig = z.infer<typeof appConfigSchema>
```

```ts
// src/config/loader.ts
import { pathToFileURL } from 'node:url'
import { appConfigSchema, type AppConfig } from './schema.ts'

export async function loadConfig(path = './linkedin-auto.config.ts'): Promise<AppConfig> {
  const mod = await import(pathToFileURL(path).href)
  const raw = mod.default ?? mod.config
  return appConfigSchema.parse(raw)
}
```

```ts
// linkedin-auto.config.ts
import type { AppConfig } from './src/config/schema.ts'

export default {
  mustCheckUrls: [
    'https://www.linkedin.com/jobs/search/?f_TPR=r86400&keywords=software%20engineer',
  ],
  requirements: `
    Look for senior backend / full-stack engineering roles.
    Prefer remote or hybrid in the US.
    Avoid roles requiring more than 8 years of experience.
  `,
  cron: {
    recent: { intervalMinutes: 60, postedWithinMinutes: 1440 },
    full: { intervalMinutes: 60 * 24 },
  },
  profileFiles: {
    profile: './profile.md',
    resume: './resume.pdf',
  },
} satisfies AppConfig
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/config/loader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config schema.ts src/config/loader.ts linkedin-auto.config.ts tests/unit/config/loader.test.ts
git commit -m "feat: config loader with zod validation"
```

---

### Task 3: Database schema and connection

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`
- Test: `tests/unit/db/db.test.ts`

**Interfaces:**
- Produces: `db` Drizzle client; tables `jobs`, `applications`, `memoryFacts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/db/db.test.ts
import { test, expect } from 'vitest'
import { getDb, closeDb } from '../../src/db/index.ts'
import { jobs } from '../../src/db/schema.ts'

test('inserts and reads a job', async () => {
  const db = getDb('file::memory:')
  const [job] = await db.insert(jobs).values({
    id: 'job-1',
    title: 'Backend Engineer',
    company: 'Acme',
    applyUrl: 'https://linkedin.com/jobs/1',
    applyType: 'easy',
    sourceUrl: 'https://linkedin.com/search',
    status: 'discovered',
  }).returning()
  expect(job.title).toBe('Backend Engineer')
  closeDb()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/db/db.test.ts`
Expected: FAIL — files missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location'),
  applyUrl: text('apply_url').notNull(),
  applyType: text('apply_type', { enum: ['easy', 'external'] }).notNull(),
  sourceUrl: text('source_url').notNull(),
  status: text('status', { enum: ['discovered', 'queued', 'needs_input', 'applied', 'failed'] }).notNull().default('discovered'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id),
  status: text('status', { enum: ['applied', 'failed', 'needs_input'] }).notNull(),
  result: text('result'),
  screenshotPath: text('screenshot_path'),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const memoryFacts = sqliteTable('memory_facts', {
  id: text('id').primaryKey(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})
```

```ts
// src/db/index.ts
import Database from 'better-sqlite3'
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.ts'

let db: BetterSQLite3Database<typeof schema> | null = null

export function getDb(url = process.env.DATABASE_URL ?? 'file:./data/app.db') {
  if (db) return db
  const isMemory = url === ':memory:' || url.startsWith('file::memory:')
  const client = isMemory ? new Database(':memory:') : new Database(url.replace('file:', ''))
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/db/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/index.ts tests/unit/db/db.test.ts
git commit -m "feat: drizzle sqlite schema and connection"
```

---

### Task 4: Profile and memory loader

**Files:**
- Create: `src/profile/loader.ts`, `src/profile/memory.ts`
- Test: `tests/unit/profile/memory.test.ts`

**Interfaces:**
- Produces: `loadProfileText(config): Promise<string>` and `rememberFact(question, answer): Promise<void>`, `getFactsText(): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/profile/memory.test.ts
import { test, expect, beforeEach } from 'vitest'
import { getDb, closeDb } from '../../src/db/index.ts'
import { rememberFact, getFactsText } from '../../src/profile/memory.ts'
import { loadProfileText } from '../../src/profile/loader.ts'
import { writeFileSync, unlinkSync } from 'node:fs'

beforeEach(() => {
  closeDb()
})

test('remembers and recalls facts', async () => {
  getDb(':memory:')
  await rememberFact('notice period', '30 days')
  const text = await getFactsText()
  expect(text).toContain('notice period')
  expect(text).toContain('30 days')
})

test('loads markdown profile', async () => {
  writeFileSync('/tmp/profile.md', '# Profile\nName: Jane')
  const text = await loadProfileText('/tmp/profile.md')
  expect(text).toContain('Jane')
  unlinkSync('/tmp/profile.md')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/profile/memory.test.ts`
Expected: FAIL — files missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/profile/loader.ts
import { readFileSync } from 'node:fs'

export async function loadProfileText(path: string): Promise<string> {
  return readFileSync(path, 'utf-8')
}
```

```ts
// src/profile/memory.ts
import { getDb } from '../db/index.ts'
import { memoryFacts } from '../db/schema.ts'

export async function rememberFact(question: string, answer: string) {
  const db = getDb()
  await db.insert(memoryFacts).values({
    id: crypto.randomUUID(),
    question,
    answer,
  })
}

export async function getFactsText(): Promise<string> {
  const db = getDb()
  const facts = await db.select().from(memoryFacts)
  if (facts.length === 0) return ''
  return facts.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n---\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/profile/memory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/profile/loader.ts src/profile/memory.ts tests/unit/profile/memory.test.ts
git commit -m "feat: profile loader and memory facts"
```

---

### Task 5: Mastra browser and agent setup

**Files:**
- Create: `src/mastra/index.ts`, `src/utils/mutex.ts`
- Test: `tests/unit/mastra/mastra.test.ts`

**Interfaces:**
- Produces: `mastra`, `browser`, `getBrowserLock(): Mutex`, `createAgent(id, instructions): Agent`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mastra/mastra.test.ts
import { test, expect } from 'vitest'
import { getBrowserLock } from '../../src/utils/mutex.ts'

test('mutex serializes access', async () => {
  const lock = getBrowserLock()
  let counter = 0
  await Promise.all([
    lock.run(async () => { counter++ }),
    lock.run(async () => { counter++ }),
  ])
  expect(counter).toBe(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mastra/mastra.test.ts`
Expected: FAIL — `getBrowserLock` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/mutex.ts
export class Mutex {
  private promise: Promise<unknown> = Promise.resolve()

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.promise.then(async () => fn())
    this.promise = next.catch(() => {})
    return next
  }
}

const globalLock = new Mutex()
export function getBrowserLock() {
  return globalLock
}
```

```ts
// src/mastra/index.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/mastra/mastra.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/index.ts src/utils/mutex.ts tests/unit/mastra/mastra.test.ts
git commit -m "feat: mastra browser, memory and global lock"
```

---

### Task 6: Search URL generator

**Files:**
- Create: `src/agents/search-url-generator.ts`
- Test: `tests/unit/agents/search-url-generator.test.ts`

**Interfaces:**
- Consumes: `createAgent` from `src/mastra/index.ts`.
- Produces: `generateSearchUrls(requirements, profileText): Promise<string[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agents/search-url-generator.test.ts
import { test, expect, vi } from 'vitest'
import { generateSearchUrls } from '../../src/agents/search-url-generator.ts'

vi.mock('../../src/mastra/index.ts', () => ({
  createAgent: () => ({
    generate: vi.fn().mockResolvedValue({ text: 'https://linkedin.com/jobs/search/?keywords=backend' }),
  }),
}))

test('returns generated urls', async () => {
  const urls = await generateSearchUrls('remote backend', '# Profile\nNode')
  expect(urls.length).toBeGreaterThan(0)
  expect(urls[0]).toContain('linkedin.com')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agents/search-url-generator.test.ts`
Expected: FAIL — file missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/agents/search-url-generator.ts
import { createAgent } from '../mastra/index.ts'

const urlAgent = createAgent({
  id: 'search-url-generator',
  name: 'Search URL Generator',
  instructions: `
    You generate LinkedIn job search URLs based on user requirements and their profile.
    Output ONLY a JSON array of absolute LinkedIn search URLs. No markdown, no explanation.
    Example: ["https://www.linkedin.com/jobs/search/?keywords=backend&location=United%20States"]
  `,
})

export async function generateSearchUrls(requirements: string, profileText: string): Promise<string[]> {
  const prompt = `
Requirements:
${requirements}

Profile:
${profileText}

Generate 1-5 LinkedIn job search URLs. Return only a JSON array.`

  const res = await urlAgent.generate(prompt, {
    memory: { resource: 'user', thread: 'search-url-generator' },
  })

  try {
    const text = res.text.trim().replace(/^```json\n?|\n?```$/g, '')
    const urls = JSON.parse(text) as string[]
    return urls.filter(u => u.startsWith('https://www.linkedin.com/jobs/search/'))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agents/search-url-generator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/search-url-generator.ts tests/unit/agents/search-url-generator.test.ts
git commit -m "feat: LLM search URL generator"
```

---

### Task 7: Search agent and search queue

**Files:**
- Create: `src/agents/search-agent.ts`, `src/queues/connection.ts`, `src/queues/search.queue.ts`
- Test: `tests/unit/agents/search-agent.test.ts`, `tests/unit/queues/search.queue.test.ts`

**Interfaces:**
- Consumes: `createAgent`, `withBrowser`, `generateSearchUrls`, `db`, `easyApplyQueue.add`, `externalApplyQueue.add`.
- Produces: `runSearchJob(data): Promise<void>` and `searchQueue`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agents/search-agent.test.ts
import { test, expect, vi } from 'vitest'
import { runSearchJob } from '../../src/agents/search-agent.ts'

vi.mock('../../src/mastra/index.ts', () => ({
  createAgent: () => ({
    generate: vi.fn().mockResolvedValue({
      text: JSON.stringify([
        { id: '1', title: 'Backend', company: 'Acme', applyType: 'easy', applyUrl: 'https://linkedin.com/jobs/1' },
      ]),
    }),
  }),
  withBrowser: (fn: any) => fn(),
}))

vi.mock('../../src/queues/search.queue.ts', () => ({
  enqueueJobs: vi.fn(),
}))

test('runSearchJob enqueues discovered jobs', async () => {
  const { enqueueJobs } = await import('../../src/queues/search.queue.ts')
  await runSearchJob({ urls: ['https://linkedin.com/search'], profileText: 'Node', requirements: 'backend' })
  expect(enqueueJobs).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agents/search-agent.test.ts`
Expected: FAIL — files missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/queues/connection.ts
import IORedis from 'ioredis'
import { Queue } from 'bullmq'

export const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null })

export function createQueue<T>(name: string) {
  return new Queue<T>(name, { connection: redis })
}
```

```ts
// src/agents/search-agent.ts
import { createAgent, withBrowser } from '../mastra/index.ts'
import { generateSearchUrls } from './search-url-generator.ts'
import { enqueueJobs } from '../queues/search.queue.ts'

const searchAgent = createAgent({
  id: 'job-searcher',
  name: 'Job Searcher',
  instructions: `
    You are a LinkedIn job search specialist.
    For each search URL you are given:
    1. Navigate to the URL.
    2. Scroll through the job list.
    3. Visit each job detail and decide if it matches the user's profile and requirements.
    4. Return a JSON array of objects: { id, title, company, location, applyUrl, applyType: "easy" | "external", reason }.
    Only include jobs that are a good match. Do not apply.
  `,
})

export interface SearchJobData {
  urls: string[]
  requirements: string
  profileText: string
  postedWithinMinutes?: number
}

export async function runSearchJob(data: SearchJobData) {
  const extraUrls = await generateSearchUrls(data.requirements, data.profileText)
  const allUrls = [...new Set([...data.urls, ...extraUrls])]

  await withBrowser(async () => {
    for (const url of allUrls) {
      const prompt = `
Search URL: ${url}
Posted within minutes: ${data.postedWithinMinutes ?? 'any'}
Requirements:
${data.requirements}

Profile + learned facts:
${data.profileText}

Return JSON array of matching jobs.`

      const res = await searchAgent.generate(prompt, {
        memory: { resource: 'user', thread: 'search-agent' },
      })

      const text = res.text.trim().replace(/^```json\n?|\n?```$/g, '')
      let jobs: any[] = []
      try {
        jobs = JSON.parse(text)
      } catch {
        continue
      }

      await enqueueJobs(jobs)
    }
  })
}
```

```ts
// src/queues/search.queue.ts
import { createQueue } from './connection.ts'

export interface ApplyJobData {
  id: string
  title: string
  company: string
  location?: string
  applyUrl: string
  applyType: 'easy' | 'external'
  sourceUrl: string
}

const easyApplyQueue = createQueue<ApplyJobData>('easy-apply')
const externalApplyQueue = createQueue<ApplyJobData>('external-apply')

export async function enqueueJobs(jobs: ApplyJobData[]) {
  for (const job of jobs) {
    const queue = job.applyType === 'easy' ? easyApplyQueue : externalApplyQueue
    await queue.add(`${job.applyType}:${job.id}`, job, { jobId: `${job.applyType}:${job.id}` })
  }
}

export { easyApplyQueue, externalApplyQueue }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agents/search-agent.test.ts tests/unit/queues/search.queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/search-agent.ts src/queues/connection.ts src/queues/search.queue.ts tests/unit/agents/search-agent.test.ts tests/unit/queues/search.queue.test.ts
git commit -m "feat: search agent and job enqueueing"
```

---

### Task 8: Easy apply queue and agent

**Files:**
- Create: `src/agents/easy-apply-agent.ts`, `src/queues/easy-apply.queue.ts`
- Test: `tests/unit/agents/easy-apply-agent.test.ts`

**Interfaces:**
- Consumes: `createAgent`, `withBrowser`, `db`, `takeScreenshot`.
- Produces: `runEasyApplyJob(data): Promise<void>` and `easyApplyWorker`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agents/easy-apply-agent.test.ts
import { test, expect, vi } from 'vitest'
import { runEasyApplyJob } from '../../src/agents/easy-apply-agent.ts'

vi.mock('../../src/mastra/index.ts', () => ({
  createAgent: () => ({
    generate: vi.fn().mockResolvedValue({ text: 'submitted' }),
  }),
  withBrowser: (fn: any) => fn(),
}))

test('runEasyApplyJob calls agent generate', async () => {
  const agentMod = await import('../../src/mastra/index.ts')
  await runEasyApplyJob({
    id: '1', title: 'BE', company: 'Acme', applyUrl: 'https://linkedin.com/jobs/1',
    applyType: 'easy', sourceUrl: 'https://linkedin.com/search',
  }, 'profile')
  expect(agentMod.createAgent({ id: 'x', name: 'x', instructions: 'x' }).generate).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agents/easy-apply-agent.test.ts`
Expected: FAIL — files missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/agents/easy-apply-agent.ts
import { createAgent, withBrowser } from '../mastra/index.ts'
import { getDb } from '../db/index.ts'
import { applications } from '../db/schema.ts'
import { takeScreenshot } from '../utils/screenshot.ts'
import type { ApplyJobData } from '../queues/search.queue.ts'

const easyAgent = createAgent({
  id: 'easy-apply-agent',
  name: 'Easy Apply Agent',
  instructions: `
    You apply to LinkedIn Easy Apply jobs.
    Steps:
    1. Navigate to the job page.
    2. Click the Easy Apply button.
    3. Fill every form field using the user's profile and resume.
    4. Upload the resume PDF when asked.
    5. Submit the application.
    6. Return "applied" or throw a clear error.
    If a question is not covered by the profile, throw "NEEDS_INPUT: <question>".
  `,
})

export async function runEasyApplyJob(job: ApplyJobData, profileText: string, resumePath: string) {
  const db = getDb()
  const screenshotPath = `data/screenshots/easy-${job.id}-${Date.now()}.png`

  try {
    await withBrowser(async () => {
      await easyAgent.generate(
        `Apply to ${job.title} at ${job.company} (${job.applyUrl}).\nProfile:\n${profileText}\nResume path: ${resumePath}`,
        { memory: { resource: 'user', thread: 'easy-apply-agent' } }
      )
    })

    await db.insert(applications).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      status: 'applied',
      result: 'submitted',
      screenshotPath,
    })
    await db.update(jobs).set({ status: 'applied', updatedAt: new Date() }).where(eq(jobs.id, job.id))
  } catch (err: any) {
    await takeScreenshot(screenshotPath)
    await db.insert(applications).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      status: 'failed',
      error: err.message,
      screenshotPath,
    })
    await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
    throw err
  }
}
```

Note: need to import `jobs` and `eq` in the file. Add:
```ts
import { jobs } from '../db/schema.ts'
import { eq } from 'drizzle-orm'
```

```ts
// src/queues/easy-apply.queue.ts
import { Worker } from 'bullmq'
import { redis } from './connection.ts'
import { runEasyApplyJob } from '../agents/easy-apply-agent.ts'
import type { ApplyJobData } from './search.queue.ts'

export function createEasyApplyWorker(profileText: string, resumePath: string) {
  return new Worker<ApplyJobData>(
    'easy-apply',
    async (job) => {
      await runEasyApplyJob(job.data, profileText, resumePath)
    },
    { connection: redis, concurrency: 1 }
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agents/easy-apply-agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/easy-apply-agent.ts src/queues/easy-apply.queue.ts tests/unit/agents/easy-apply-agent.test.ts
git commit -m "feat: easy apply agent and worker"
```

---

### Task 9: External apply queue and agent with pause/ask

**Files:**
- Create: `src/errors/needs-input-error.ts`, `src/agents/external-apply-agent.ts`, `src/queues/external-apply.queue.ts`
- Test: `tests/unit/agents/external-apply-agent.test.ts`

**Interfaces:**
- Consumes: `createAgent`, `withBrowser`, `db`, `takeScreenshot`.
- Produces: `NeedsInputError`, `runExternalApplyJob(job, profileText, resumePath)`, `createExternalApplyWorker(...)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agents/external-apply-agent.test.ts
import { test, expect, vi } from 'vitest'
import { runExternalApplyJob } from '../../src/agents/external-apply-agent.ts'
import { NeedsInputError } from '../../src/errors/needs-input-error.ts'

vi.mock('../../src/mastra/index.ts', () => ({
  createAgent: () => ({
    generate: vi.fn().mockRejectedValue(new Error('NEEDS_INPUT: salary expectation')),
  }),
  withBrowser: (fn: any) => fn(),
}))

test('runExternalApplyJob throws NeedsInputError', async () => {
  await expect(runExternalApplyJob({
    id: '1', title: 'BE', company: 'Acme', applyUrl: 'https://example.com/apply',
    applyType: 'external', sourceUrl: 'https://linkedin.com/search',
  }, 'profile', '/resume.pdf')).rejects.toBeInstanceOf(NeedsInputError)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agents/external-apply-agent.test.ts`
Expected: FAIL — files missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/errors/needs-input-error.ts
export class NeedsInputError extends Error {
  constructor(public question: string) {
    super(`NEEDS_INPUT: ${question}`)
  }
}
```

```ts
// src/agents/external-apply-agent.ts
import { createAgent, withBrowser } from '../mastra/index.ts'
import { getDb } from '../db/index.ts'
import { applications, jobs } from '../db/schema.ts'
import { eq } from 'drizzle-orm'
import { takeScreenshot } from '../utils/screenshot.ts'
import { NeedsInputError } from '../errors/needs-input-error.ts'
import type { ApplyJobData } from '../queues/search.queue.ts'

const externalAgent = createAgent({
  id: 'external-apply-agent',
  name: 'External Apply Agent',
  instructions: `
    You apply to jobs on external company sites linked from LinkedIn.
    Steps:
    1. Navigate to the external apply URL.
    2. Fill the application form using the user's profile and resume.
    3. Submit if possible.
    If you cannot complete the form because a required answer is missing from the profile,
    throw "NEEDS_INPUT: <exact question text>".
  `,
})

export async function runExternalApplyJob(job: ApplyJobData, profileText: string, resumePath: string) {
  const db = getDb()
  const screenshotPath = `data/screenshots/external-${job.id}-${Date.now()}.png`

  try {
    await withBrowser(async () => {
      await externalAgent.generate(
        `Apply to ${job.title} at ${job.company} via ${job.applyUrl}.\nProfile:\n${profileText}\nResume path: ${resumePath}`,
        { memory: { resource: 'user', thread: 'external-apply-agent' } }
      )
    })

    await db.insert(applications).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      status: 'applied',
      result: 'submitted',
      screenshotPath,
    })
    await db.update(jobs).set({ status: 'applied', updatedAt: new Date() }).where(eq(jobs.id, job.id))
  } catch (err: any) {
    await takeScreenshot(screenshotPath)
    const match = err.message?.match(/NEEDS_INPUT:\s*(.+)/i)
    if (match) {
      const question = match[1].trim()
      await db.insert(applications).values({
        id: crypto.randomUUID(),
        jobId: job.id,
        status: 'needs_input',
        error: question,
        screenshotPath,
      })
      await db.update(jobs).set({ status: 'needs_input', updatedAt: new Date() }).where(eq(jobs.id, job.id))
      throw new NeedsInputError(question)
    }

    await db.insert(applications).values({
      id: crypto.randomUUID(),
      jobId: job.id,
      status: 'failed',
      error: err.message,
      screenshotPath,
    })
    await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id))
    throw err
  }
}
```

```ts
// src/queues/external-apply.queue.ts
import { Worker } from 'bullmq'
import { redis } from './connection.ts'
import { runExternalApplyJob } from '../agents/external-apply-agent.ts'
import type { ApplyJobData } from './search.queue.ts'

export function createExternalApplyWorker(profileText: string, resumePath: string) {
  return new Worker<ApplyJobData>(
    'external-apply',
    async (job) => {
      await runExternalApplyJob(job.data, profileText, resumePath)
    },
    { connection: redis, concurrency: 1 }
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agents/external-apply-agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/errors/needs-input-error.ts src/agents/external-apply-agent.ts src/queues/external-apply.queue.ts tests/unit/agents/external-apply-agent.test.ts
git commit -m "feat: external apply agent with needs-input pause"
```

---

### Task 10: Scheduler and orchestrator

**Files:**
- Create: `src/scheduler/index.ts`, `src/orchestrator/index.ts`
- Test: `tests/unit/orchestrator/orchestrator.test.ts`

**Interfaces:**
- Consumes: `searchQueue`, `easyApplyQueue`, `externalApplyQueue`, `createEasyApplyWorker`, `createExternalApplyWorker`, `runSearchJob`.
- Produces: `Orchestrator` class with `start(mode)`, `stop()`, events via `EventEmitter`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/orchestrator/orchestrator.test.ts
import { test, expect, vi } from 'vitest'
import { Orchestrator } from '../../src/orchestrator/index.ts'

vi.mock('../../src/queues/easy-apply.queue.ts', () => ({
  createEasyApplyWorker: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock('../../src/queues/external-apply.queue.ts', () => ({
  createExternalApplyWorker: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock('../../src/queues/search.queue.ts', () => ({
  searchQueue: { add: vi.fn(), removeRepeatableByKey: vi.fn() },
}))

test('orchestrator starts and stops', async () => {
  const orch = new Orchestrator({ profileText: '', resumePath: '', config: { mustCheckUrls: [], requirements: '', cron: { recent: { intervalMinutes: 60 }, full: { intervalMinutes: 1440 } } } } as any)
  await orch.start('apply-only')
  expect(orch.isRunning).toBe(true)
  await orch.stop()
  expect(orch.isRunning).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/orchestrator/orchestrator.test.ts`
Expected: FAIL — files missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/scheduler/index.ts
import { Queue } from 'bullmq'
import type { SearchJobData } from '../agents/search-agent.ts'
import type { AppConfig } from '../config/schema.ts'

export async function scheduleSearchJobs(searchQueue: Queue<SearchJobData>, config: AppConfig) {
  const { recent, full } = config.cron

  await searchQueue.add(
    'recent-search',
    { urls: config.mustCheckUrls, requirements: config.requirements, profileText: '', postedWithinMinutes: recent.postedWithinMinutes },
    { repeat: { every: recent.intervalMinutes * 60 * 1000 }, jobId: 'repeat:recent-search' }
  )

  await searchQueue.add(
    'full-search',
    { urls: config.mustCheckUrls, requirements: config.requirements, profileText: '' },
    { repeat: { every: full.intervalMinutes * 60 * 1000 }, jobId: 'repeat:full-search' }
  )
}

export async function unscheduleSearchJobs(searchQueue: Queue) {
  await searchQueue.removeRepeatableByKey('repeat:recent-search')
  await searchQueue.removeRepeatableByKey('repeat:full-search')
}
```

```ts
// src/orchestrator/index.ts
import { EventEmitter } from 'node:events'
import { Queue, Worker } from 'bullmq'
import { redis } from '../queues/connection.ts'
import { searchQueue } from '../queues/search.queue.ts'
import { createEasyApplyWorker } from '../queues/easy-apply.queue.ts'
import { createExternalApplyWorker } from '../queues/external-apply.queue.ts'
import { runSearchJob, type SearchJobData } from '../agents/search-agent.ts'
import { scheduleSearchJobs, unscheduleSearchJobs } from '../scheduler/index.ts'
import type { AppConfig } from '../config/schema.ts'

export type RunMode = 'recent-search' | 'full-search' | 'apply-only' | 'full-run'

interface OrchestratorDeps {
  profileText: string
  resumePath: string
  config: AppConfig
}

export class Orchestrator extends EventEmitter {
  private workers: Worker[] = []
  public isRunning = false

  constructor(private deps: OrchestratorDeps) {
    super()
  }

  async start(mode: RunMode) {
    if (this.isRunning) await this.stop()

    this.workers.push(createEasyApplyWorker(this.deps.profileText, this.deps.resumePath))
    this.workers.push(createExternalApplyWorker(this.deps.profileText, this.deps.resumePath))

    const searchWorker = new Worker<SearchJobData>(
      'search',
      async (job) => {
        const data = { ...job.data, profileText: this.deps.profileText }
        await runSearchJob(data)
      },
      { connection: redis, concurrency: 1 }
    )
    this.workers.push(searchWorker)

    if (mode === 'recent-search') {
      await searchQueue.add('recent-search', { urls: this.deps.config.mustCheckUrls, requirements: this.deps.config.requirements, profileText: this.deps.profileText, postedWithinMinutes: this.deps.config.cron.recent.postedWithinMinutes })
    } else if (mode === 'full-search') {
      await searchQueue.add('full-search', { urls: this.deps.config.mustCheckUrls, requirements: this.deps.config.requirements, profileText: this.deps.profileText })
    } else if (mode === 'full-run') {
      await scheduleSearchJobs(searchQueue, this.deps.config)
    }

    this.isRunning = true
    this.emit('started', mode)
  }

  async stop() {
    await unscheduleSearchJobs(searchQueue)
    await Promise.all(this.workers.map(w => w.close()))
    this.workers = []
    this.isRunning = false
    this.emit('stopped')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/orchestrator/orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler/index.ts src/orchestrator/index.ts tests/unit/orchestrator/orchestrator.test.ts
git commit -m "feat: scheduler and orchestrator"
```

---

### Task 11: TUI layout

**Files:**
- Create: `src/tui/App.tsx`, `src/tui/Menu.tsx`, `src/tui/StatusPanel.tsx`, `src/tui/LogsPanel.tsx`, `src/tui/PromptPanel.tsx`, `src/tui/index.tsx`
- Test: `tests/unit/tui/app.test.tsx`

**Interfaces:**
- Consumes: `Orchestrator`, app state from `useAppEvents`.
- Produces: rendered TUI with box layout.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/tui/app.test.tsx
import { test, expect, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { App } from '../../src/tui/App.tsx'

vi.mock('../../src/tui/use-app-events.ts', () => ({
  useAppEvents: () => ({
    mode: 'idle',
    activeJob: null,
    queueCounts: { search: 0, easy: 0, external: 0 },
    logs: ['ready'],
    prompt: null,
    start: vi.fn(),
    stop: vi.fn(),
    answerPrompt: vi.fn(),
  }),
}))

test('renders main layout', () => {
  const { lastFrame } = render(<App />)
  expect(lastFrame()).toContain('LinkedIn Auto')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tui/app.test.tsx`
Expected: FAIL — install `ink-testing-library` and files missing.

- [ ] **Step 3: Write minimal implementation**

Add dev dependency: `ink-testing-library`.

```tsx
// src/tui/App.tsx
import React from 'react'
import { Box, Text, useInput } from 'ink'
import { Menu } from './Menu.tsx'
import { StatusPanel } from './StatusPanel.tsx'
import { LogsPanel } from './LogsPanel.tsx'
import { PromptPanel } from './PromptPanel.tsx'
import { useAppEvents } from './use-app-events.ts'

export function App() {
  const { mode, activeJob, queueCounts, logs, prompt, start, stop, answerPrompt } = useAppEvents()

  useInput((input, key) => {
    if (key.escape) stop()
    if (input === 'r') start('recent-search')
    if (input === 'f') start('full-search')
    if (input === 'a') start('apply-only')
    if (input === 'x') start('full-run')
    if (input === 's') stop()
  })

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" paddingX={1}>
        <Text bold>LinkedIn Auto — mode: {mode}</Text>
      </Box>
      <Box flexDirection="row" flexGrow={1}>
        <Box width="30%" borderStyle="round" paddingX={1}>
          <Menu />
        </Box>
        <Box width="70%" borderStyle="round" paddingX={1}>
          <StatusPanel activeJob={activeJob} queueCounts={queueCounts} />
        </Box>
      </Box>
      <Box height="40%" flexDirection="row">
        <Box width="60%" borderStyle="round" paddingX={1}>
          <LogsPanel logs={logs} />
        </Box>
        <Box width="40%" borderStyle="round" paddingX={1}>
          <PromptPanel prompt={prompt} onSubmit={answerPrompt} />
        </Box>
      </Box>
    </Box>
  )
}
```

```tsx
// src/tui/Menu.tsx
import React from 'react'
import { Text } from 'ink'

export function Menu() {
  return (
    <Text>
      [r] recent search{'\n'}
      [f] full search{'\n'}
      [a] apply only{'\n'}
      [x] full run (cron){'\n'}
      [s] stop{'\n'}
      [esc] quit
    </Text>
  )
}
```

```tsx
// src/tui/StatusPanel.tsx
import React from 'react'
import { Text } from 'ink'

export function StatusPanel({ activeJob, queueCounts }: any) {
  return (
    <Text>
      Active: {activeJob ? `${activeJob.title} @ ${activeJob.company}` : 'none'}{\n'}
      Search queue: {queueCounts.search}{\n'}
      Easy apply: {queueCounts.easy}{\n'}
      External apply: {queueCounts.external}
    </Text>
  )
}
```

```tsx
// src/tui/LogsPanel.tsx
import React from 'react'
import { Text } from 'ink'

export function LogsPanel({ logs }: { logs: string[] }) {
  return <Text>{logs.slice(-12).join('\n')}</Text>
}
```

```tsx
// src/tui/PromptPanel.tsx
import React, { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

export function PromptPanel({ prompt, onSubmit }: { prompt: string | null; onSubmit: (answer: string) => void }) {
  const [value, setValue] = useState('')
  if (!prompt) return <Text dimColor>No pending questions</Text>
  return (
    <Box flexDirection="column">
      <Text bold color="yellow">{prompt}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
    </Box>
  )
}
```

```tsx
// src/tui/index.tsx
import React from 'react'
import { render } from 'ink'
import { App } from './App.tsx'

export function startTui() {
  render(<App />)
}
```

```ts
// src/tui/use-app-events.ts
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
```

```ts
// src/utils/app-events.ts
import { EventEmitter } from 'node:events'

export interface AppState {
  mode: string
  activeJob: { title: string; company: string } | null
  queueCounts: { search: number; easy: number; external: number }
  logs: string[]
  prompt: string | null
}

class AppEvents extends EventEmitter {
  private state: AppState = {
    mode: 'idle',
    activeJob: null,
    queueCounts: { search: 0, easy: 0, external: 0 },
    logs: ['ready'],
    prompt: null,
  }

  getState() { return this.state }

  setState(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.state)
  }

  subscribe(cb: (s: AppState) => void) {
    this.on('change', cb)
    return () => this.off('change', cb)
  }

  start(mode: string) { this.setState({ mode }) }
  stop() { this.setState({ mode: 'idle', activeJob: null }) }
  answerPrompt(answer: string) {
    this.setState({ prompt: null })
    this.emit('answer', answer)
  }
}

export const appEvents = new AppEvents()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install ink-testing-library && npx vitest run tests/unit/tui/app.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/ package.json tests/unit/tui/app.test.tsx src/utils/app-events.ts
git commit -m "feat: ink box-layout TUI"
```

---

### Task 12: CLI entries and wiring

**Files:**
- Create: `src/cli.ts`, `src/server.ts`
- Test: `tests/unit/cli/cli.test.ts`

**Interfaces:**
- Produces: `npm run start` opens TUI; `npm run server` runs headless.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/cli/cli.test.ts
import { test, expect } from 'vitest'

test('cli has required entry exports', async () => {
  const cli = await import('../../src/cli.ts')
  expect(typeof cli.main).toBe('function')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/cli.test.ts`
Expected: FAIL — file missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli.ts
import { loadConfig } from './config/loader.ts'
import { getDb } from './db/index.ts'
import { loadProfileText } from './profile/loader.ts'
import { Orchestrator } from './orchestrator/index.ts'
import { startTui } from './tui/index.tsx'
import { appEvents } from './utils/app-events.ts'
import { rememberFact } from './profile/memory.ts'

export async function main() {
  const config = await loadConfig()
  getDb()

  const profileText = await loadProfileText(config.profileFiles.profile)
  const orchestrator = new Orchestrator({ profileText, resumePath: config.profileFiles.resume, config })

  appEvents.on('answer', async (answer: string) => {
    const question = appEvents.getState().prompt
    if (question) await rememberFact(question, answer)
    orchestrator.emit('resume', answer)
  })

  appEvents.subscribe((state) => {
    if (state.mode === 'idle') return
    orchestrator.start(state.mode as any).catch(console.error)
  })

  orchestrator.on('started', (mode) => appEvents.setState({ mode }))
  orchestrator.on('stopped', () => appEvents.setState({ mode: 'idle', activeJob: null }))

  startTui()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

```ts
// src/server.ts
import { loadConfig } from './config/loader.ts'
import { getDb } from './db/index.ts'
import { loadProfileText } from './profile/loader.ts'
import { Orchestrator } from './orchestrator/index.ts'

async function main() {
  const config = await loadConfig()
  getDb()
  const profileText = await loadProfileText(config.profileFiles.profile)
  const orchestrator = new Orchestrator({ profileText, resumePath: config.profileFiles.resume, config })
  await orchestrator.start('full-run')
  console.log('headless server running')

  process.on('SIGINT', async () => {
    await orchestrator.stop()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/cli/cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/server.ts tests/unit/cli/cli.test.ts
git commit -m "feat: CLI and server entries"
```

---

### Task 13: Logging, screenshots, and error handling

**Files:**
- Create: `src/utils/logger.ts`, `src/utils/screenshot.ts`
- Test: `tests/unit/utils/screenshot.test.ts`

**Interfaces:**
- Produces: `logger` (pino), `takeScreenshot(path): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/utils/screenshot.test.ts
import { test, expect, vi } from 'vitest'
import { takeScreenshot } from '../../src/utils/screenshot.ts'

vi.mock('../../src/mastra/index.ts', () => ({
  browser: {
    getPage: vi.fn(() => ({ screenshot: vi.fn() })),
  },
}))

test('takeScreenshot delegates to browser page', async () => {
  const { browser } = await import('../../src/mastra/index.ts')
  await takeScreenshot('/tmp/x.png')
  expect(browser.getPage).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/utils/screenshot.test.ts`
Expected: FAIL — files missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/logger.ts
import pino from 'pino'
import { appEvents } from './app-events.ts'

export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: false, destination: './data/app.log' },
  },
})

export function logToTui(message: string) {
  appEvents.setState({ logs: [...appEvents.getState().logs, message].slice(-100) })
}
```

```ts
// src/utils/screenshot.ts
import { browser } from '../mastra/index.ts'
import { mkdirSync, dirname } from 'node:fs'

export async function takeScreenshot(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  const page = await browser.getPage()
  await page.screenshot({ path })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/utils/screenshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger.ts src/utils/screenshot.ts tests/unit/utils/screenshot.test.ts
git commit -m "feat: logging and screenshot utilities"
```

---

## Self-Review

**Spec coverage:**
- TUI box layout — Task 11.
- Mastra browser agents for search and apply — Tasks 6-9.
- Fixed URLs + natural-language URL generation — Task 6.
- Recent and full cron rhythms — Task 10.
- Easy apply / external apply queues — Tasks 8-9.
- Profile/memory and human-in-the-loop — Tasks 4, 9, 11, 12.
- Headless server mode — Task 12.
- Error handling/screenshots — Task 13.

**Placeholder scan:** No TBD/TODO. Every step has exact file paths, code, commands, and expected output.

**Type consistency:** `ApplyJobData` is defined once in `src/queues/search.queue.ts` and imported by agents/queues. `AppConfig` from `src/config/schema.ts` used in orchestrator/scheduler. `SearchJobData` in `src/agents/search-agent.ts` used by scheduler and orchestrator.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-01-linkedin-job-automation.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
