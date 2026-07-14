# Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the opentui/solid TUI shell (opencode-styled), the shared-browser login bootstrap, and the config/profile/command/sidebar framework — with stub agent commands — so `bun run dev` opens a visible browser, you can log into LinkedIn + Gmail by hand, `/verify-login` unlocks the app, and tabs/sidebar/commands all work end to end before any real search/apply logic exists.

**Architecture:** Single Bun process. `agent-browser`'s `BrowserManager` launches one real, visible Chrome instance at startup and exposes its CDP URL — every later phase's Mastra `AgentBrowser` will attach to that same browser over CDP instead of launching its own (verified against real package APIs during planning). A Solid store (`src/state/app-state.ts`) holds session/tab/sidebar state; `@opentui/solid` renders it. A small command registry routes `/command` input to handlers scoped by active tab, locked to global-only commands until `/verify-login` passes.

**Tech Stack:** Bun runtime, TypeScript, `@opentui/core` + `@opentui/solid` (pinned `0.4.3`, verified working), `solid-js`, `agent-browser` (direct dependency, verified `0.19.0`), `@mastra/core`/`@mastra/agent-browser`/`@mastra/pg`/`@mastra/memory` (kept from old repo, Postgres storage swapped in), `drizzle-orm` (`drizzle-orm/node-postgres`, verified export) + `pg` + `drizzle-kit`, `bullmq` + `ioredis` (installed now, wired up starting Phase 2), `zod`, `pino`. Test runner: **`bun test`** (not vitest — vitest's oxc transform rejects the `jsx:"preserve"` + `jsxImportSource:"@opentui/solid"` combination Bun/opentui require; confirmed by running a real component both ways during planning. `@opentui/solid` ships a `bun-test-node` shim specifically for `bun test`).

## Global Constraints

- Browser is **always visible** (`headless: false`, hardcoded) — no headless config, no toggle, anywhere in this codebase.
- All three future agents (search, easy-apply, external-apply) must be able to attach to the **same** browser session opened at startup — never launch a second browser. This phase establishes that via `getSharedCdpUrl()`.
- No credentials (LinkedIn/Gmail passwords, API keys for those services) are ever read, stored, or requested by this app — login is always manual, in the visible browser window.
- Config file: `linkedin-auto.config.ts`, validated with zod (`src/config/schema.ts`). No `headless` field.
- Profile data: `resume.md` (free text) + `profile.json` (structured, zod-validated) — paths configurable via config, defaults `./resume.md` and `./profile.json`.
- DB: Postgres only, via `drizzle-orm/node-postgres`. No SQLite/libsql anywhere in the new code.
- Package manager/runtime: Bun throughout. Scripts use `bun run`, not `tsx`/`node`.

---

## File Structure

**Delete** (old Ink TUI / sqlite / orchestrator-era code, superseded by this plan — see spec `docs/superpowers/specs/2026-07-14-tui-rebuild-design.md` for why):
- `src/server.ts`
- `src/tui/App.tsx`, `src/tui/index.tsx`, `src/tui/LogsPanel.tsx`, `src/tui/Menu.tsx`, `src/tui/PromptPanel.tsx`, `src/tui/StatusPanel.tsx`, `src/tui/use-app-events.ts`
- `src/orchestrator/index.ts`
- `src/scheduler/index.ts`
- `src/agents/easy-apply-agent.ts`, `src/agents/external-apply-agent.ts`, `src/agents/search-agent.ts`, `src/agents/search-url-generator.ts`
- `src/queues/connection.ts`, `src/queues/dead-letter.queue.ts`, `src/queues/easy-apply.queue.ts`, `src/queues/external-apply.queue.ts`, `src/queues/search.queue.ts`
- `src/profile/memory.ts`, `src/profile/loader.ts` (both recreated fresh in Task 3)
- `src/mastra/index.ts` (recreated in Task 5)
- `src/utils/app-events.ts`, `src/utils/mutex.ts`
- `src/cli.ts` (replaced by `src/index.ts` in Task 10)
- `src/db/schema.ts`, `src/db/index.ts` (sqlite versions, recreated in Task 4)
- `vitest.config.ts`
- Tests: `tests/unit/cli/`, `tests/unit/agents/`, `tests/unit/orchestrator/`, `tests/unit/scheduler/`, `tests/unit/queues/`, `tests/unit/mastra/`, `tests/unit/profile/memory.test.ts`, `tests/unit/tui/app.test.tsx`, `tests/unit/db/db.test.ts`

**Keep, untouched**: `src/errors/needs-input-error.ts`, `src/utils/path.ts` + its test, `src/utils/screenshot.ts` + its test, `tests/unit/smoke.test.ts`.

**Rewrite in place**: `package.json`, `tsconfig.json`, `.env.example`, `src/utils/logger.ts` + `tests/unit/utils/logger.test.ts` (Task 1); `src/config/schema.ts`, `src/config/loader.ts`, `linkedin-auto.config.ts`, `tests/unit/config/loader.test.ts` (Task 2).

**Create**:
- `bunfig.toml` (Task 1)
- `src/profile/profile.schema.ts`, `src/profile/loader.ts`, `resume.example.md`, `profile.example.json` + tests (Task 3)
- `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts` + test (Task 4)
- `src/browser/session.ts`, `src/browser/verify-login.ts` + tests (Task 5)
- `src/state/types.ts`, `src/state/app-state.ts` + test (Task 6)
- `src/commands/types.ts`, `src/commands/registry.ts`, `src/commands/dispatch.ts`, `src/commands/global-commands.ts`, `src/commands/stub-commands.ts` + tests (Task 7)
- `src/tui/theme.ts`, `src/tui/components/Header.tsx`, `src/tui/components/Sidebar.tsx`, `src/tui/components/LogPanel.tsx`, `src/tui/components/InputBar.tsx` + tests (Task 8)
- `src/tui/App.tsx`, `src/tui/index.tsx` + test (Task 9)
- `src/index.ts` (Task 10)

---

### Task 1: Project scaffold — Bun runtime, opentui deps, delete dead code

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.env.example`, `src/utils/logger.ts`, `tests/unit/utils/logger.test.ts`
- Create: `bunfig.toml`
- Delete: all files listed under "Delete" above, plus `vitest.config.ts`

**Interfaces:**
- Produces: `logger` (pino instance, file-only), `ensureDataDir()` — both from `src/utils/logger.ts`, used by every later task that logs.

- [ ] **Step 1: Delete dead source files and their tests**

```bash
rm -f src/server.ts
rm -rf src/tui
rm -rf src/orchestrator
rm -rf src/scheduler
rm -rf src/agents
rm -rf src/queues
rm -f src/profile/memory.ts src/profile/loader.ts
rm -f src/mastra/index.ts
rm -f src/utils/app-events.ts src/utils/mutex.ts
rm -f src/cli.ts
rm -f src/db/schema.ts src/db/index.ts
rm -f vitest.config.ts
rm -rf tests/unit/cli tests/unit/agents tests/unit/orchestrator tests/unit/scheduler tests/unit/queues tests/unit/mastra
rm -f tests/unit/profile/memory.test.ts
rm -rf tests/unit/tui
rm -rf tests/unit/db
```

- [ ] **Step 2: Rewrite `package.json`**

```json
{
  "name": "linkedin-automation",
  "version": "0.2.0",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "dev": "bun run src/index.ts",
    "start": "NODE_ENV=production bun run src/index.ts",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "@mastra/agent-browser": "0.4.0",
    "@mastra/core": "1.48.0",
    "@mastra/memory": "1.22.0",
    "@mastra/pg": "1.15.1",
    "agent-browser": "0.19.0",
    "bullmq": "5.79.2",
    "drizzle-orm": "0.45.2",
    "ioredis": "5.11.1",
    "pg": "8.22.0",
    "pino": "10.3.1",
    "pino-pretty": "13.1.3",
    "playwright-core": "1.61.1",
    "solid-js": "1.9.14",
    "@opentui/core": "0.4.3",
    "@opentui/solid": "0.4.3",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "26.1.0",
    "@types/pg": "8.20.0",
    "drizzle-kit": "0.31.10",
    "typescript": "6.0.3"
  }
}
```

- [ ] **Step 3: Create `bunfig.toml`**

```toml
preload = ["@opentui/solid/preload"]

[test]
preload = ["@opentui/solid/preload"]
```

- [ ] **Step 4: Update `tsconfig.json`**

```json
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
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid",
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*", "linkedin-auto.config.ts", "drizzle.config.ts"]
}
```

- [ ] **Step 5: Rewrite `.env.example`** (drop credentials/headless, add Postgres)

```
MASTRA_MODEL=opencode-go/kimi-k2.7-code
OPENCODE_API_KEY=
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgres://app:app@localhost:5432/linkedin_auto
```

- [ ] **Step 6: Rewrite `src/utils/logger.ts`** (drop the TUI event-bus stream — per-tab logs are pushed directly by command handlers via `app-state` in Task 6, not routed through pino)

```ts
import pino, { type Logger } from 'pino'
import { mkdirSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import pinoPretty from 'pino-pretty'

const DATA_DIR = './data'
const LOG_FILE = `${DATA_DIR}/app.log`

export function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true })
}

let _logger: Logger | null = null

export function createLogger(): Logger {
  ensureDataDir()

  const prettyStream = pinoPretty({ colorize: false })
  const fileStream = createWriteStream(LOG_FILE, { flags: 'a' })
  prettyStream.pipe(fileStream)

  _logger = pino(prettyStream)
  return _logger
}

export const logger = new Proxy({} as Logger, {
  get(_target, prop) {
    if (!_logger) {
      createLogger()
    }
    return (_logger as Logger)[prop as keyof Logger]
  },
})
```

- [ ] **Step 7: Rewrite `tests/unit/utils/logger.test.ts`**

```ts
import { describe, test, expect } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { ensureDataDir, createLogger } from '../../../src/utils/logger.ts'

describe('logger', () => {
  test('ensureDataDir creates ./data', () => {
    rmSync('./data', { recursive: true, force: true })
    ensureDataDir()
    expect(existsSync('./data')).toBe(true)
  })

  test('createLogger returns a pino logger with info/error methods', () => {
    const log = createLogger()
    expect(typeof log.info).toBe('function')
    expect(typeof log.error).toBe('function')
  })
})
```

- [ ] **Step 8: Install dependencies**

Run: `bun install`
Expected: installs without error (a `postinstall` prompt for `agent-browser`/`playwright-core` may appear — run `bun pm trust agent-browser playwright-core` if `bun pm untrusted` lists them, so Playwright's browser binary install runs).

- [ ] **Step 9: Verify typecheck and remaining tests pass**

Run: `bun run typecheck`
Expected: no errors (only `config/*`, `errors/needs-input-error.ts`, `utils/logger.ts`, `utils/path.ts`, `utils/screenshot.ts`, `db/` empty dir, `profile/` empty dir remain under `src/`, plus `linkedin-auto.config.ts` which still matches the untouched `AppConfig` type).

Run: `bun test`
Expected: `tests/unit/smoke.test.ts`, `tests/unit/utils/path.test.ts`, `tests/unit/utils/screenshot.test.ts`, `tests/unit/utils/logger.test.ts` all pass (config/loader.test.ts still passes too — schema unchanged until Task 2).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Bun/opentui runtime, remove dead Ink/sqlite/orchestrator code"
```

---

### Task 2: Config schema rewrite

**Files:**
- Modify: `src/config/schema.ts`, `src/config/loader.ts` (loader logic unchanged — confirm it still compiles against new schema), `linkedin-auto.config.ts`, `tests/unit/config/loader.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AppConfig` type and `appConfigSchema` (zod) from `src/config/schema.ts` — consumed by Task 3 (`profileFiles`), Task 6 (`settings` defaults), Task 10 (`src/index.ts`).
  ```ts
  interface AppConfig {
    mustCheckUrls: string[]
    requirements: string
    concurrency: number
    model: string
    profileFiles: { resume: string; profile: string }
    search: { irrelevantBailRatio: number }
  }
  ```

- [ ] **Step 1: Write the failing test**

Replace `tests/unit/config/loader.test.ts`:

```ts
import { describe, test, expect } from 'bun:test'
import { loadConfig } from '../../../src/config/loader.ts'

describe('loadConfig', () => {
  test('loads and validates sample config', async () => {
    const config = await loadConfig('./linkedin-auto.config.ts')
    expect(config.mustCheckUrls).toHaveLength(1)
    expect(config.requirements).toContain('remote')
    expect(config.search.irrelevantBailRatio).toBe(0.5)
    expect(config.profileFiles.resume).toBe('./resume.md')
    expect(config.profileFiles.profile).toBe('./profile.json')
  })

  test('rejects config missing requirements', async () => {
    await expect(
      import('../../../src/config/schema.ts').then(({ appConfigSchema }) =>
        appConfigSchema.parse({
          mustCheckUrls: ['https://example.com'],
          profileFiles: { resume: './resume.md', profile: './profile.json' },
        }),
      ),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config/loader.test.ts`
Expected: FAIL — `config.search` is undefined (old schema has no `search` field, still has `cron`).

- [ ] **Step 3: Rewrite `src/config/schema.ts`**

```ts
import { z } from 'zod'

export const appConfigSchema = z.object({
  mustCheckUrls: z.array(z.string().url()),
  requirements: z.string().min(1),
  concurrency: z.number().positive().default(1),
  model: z.string().default('opencode-go/kimi-k2.7-code'),
  profileFiles: z.object({
    resume: z.string(),
    profile: z.string(),
  }),
  search: z.object({
    irrelevantBailRatio: z.number().min(0).max(1).default(0.5),
  }).default({ irrelevantBailRatio: 0.5 }),
})

export type AppConfig = z.infer<typeof appConfigSchema>
```

- [ ] **Step 4: Confirm `src/config/loader.ts` still compiles as-is**

```ts
import { pathToFileURL } from 'node:url'
import { appConfigSchema, type AppConfig } from './schema.ts'

export async function loadConfig(path = './linkedin-auto.config.ts'): Promise<AppConfig> {
  const mod = await import(pathToFileURL(path).href)
  const raw = mod.default ?? mod.config
  return appConfigSchema.parse(raw)
}
```

(No changes needed — confirm by reading the file; it only depends on `appConfigSchema`/`AppConfig`.)

- [ ] **Step 5: Rewrite `linkedin-auto.config.ts`**

```ts
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
  concurrency: 1,
  profileFiles: {
    resume: './resume.md',
    profile: './profile.json',
  },
  model: 'opencode-go/kimi-k2.7-code',
  search: {
    irrelevantBailRatio: 0.5,
  },
} satisfies AppConfig
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/unit/config/loader.test.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts src/config/loader.ts linkedin-auto.config.ts tests/unit/config/loader.test.ts
git commit -m "feat(config): drop cron/headless fields, add search.irrelevantBailRatio"
```

---

### Task 3: Profile data model (resume.md + profile.json)

**Files:**
- Create: `src/profile/profile.schema.ts`, `src/profile/loader.ts`, `resume.example.md`, `profile.example.json`
- Test: `tests/unit/profile/loader.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (consumed by Task 10's `src/index.ts`, and by Phase 2/3/4 agents later):
  ```ts
  interface ProfileData {
    contact: { email: string; phone: string; location: string }
    workAuth: { authorized: boolean; requiresSponsorship: boolean }
    experienceYears: number
    salaryExpectation: { min: number; max: number; currency: string }
    links: { linkedin: string; github: string; portfolio: string }
    answers: Record<string, string>
  }
  function loadResume(path: string): Promise<string>
  function loadProfile(path: string): Promise<ProfileData>
  function saveLearnedAnswer(path: string, question: string, answer: string): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/profile/loader.test.ts`:

```ts
import { describe, test, expect, afterEach } from 'bun:test'
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadResume, loadProfile, saveLearnedAnswer } from '../../../src/profile/loader.ts'

const dir = mkdtempSync(path.join(tmpdir(), 'profile-test-'))
const profilePath = path.join(dir, 'profile.json')
const resumePath = path.join(dir, 'resume.md')

const sampleProfile = {
  contact: { email: 'jaswanthjas20@gmail.com', phone: '555-0100', location: 'Remote' },
  workAuth: { authorized: true, requiresSponsorship: false },
  experienceYears: 5,
  salaryExpectation: { min: 120000, max: 160000, currency: 'USD' },
  links: { linkedin: '', github: '', portfolio: '' },
  answers: {},
}

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('profile loader', () => {
  test('loadResume reads free text', async () => {
    writeFileSync(resumePath, '# Resume\n\nSenior Engineer.')
    const text = await loadResume(resumePath)
    expect(text).toContain('Senior Engineer')
  })

  test('loadProfile parses and validates profile.json', async () => {
    writeFileSync(profilePath, JSON.stringify(sampleProfile))
    const profile = await loadProfile(profilePath)
    expect(profile.contact.email).toBe('jaswanthjas20@gmail.com')
    expect(profile.experienceYears).toBe(5)
  })

  test('loadProfile rejects invalid profile.json', async () => {
    writeFileSync(profilePath, JSON.stringify({ contact: {} }))
    await expect(loadProfile(profilePath)).rejects.toThrow()
  })

  test('saveLearnedAnswer appends and persists a Q&A pair', async () => {
    writeFileSync(profilePath, JSON.stringify(sampleProfile))
    await saveLearnedAnswer(profilePath, 'Are you willing to relocate?', 'No')
    const onDisk = JSON.parse(readFileSync(profilePath, 'utf-8'))
    expect(onDisk.answers['Are you willing to relocate?']).toBe('No')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/profile/loader.test.ts`
Expected: FAIL with "Cannot find module '../../../src/profile/loader.ts'".

- [ ] **Step 3: Create `src/profile/profile.schema.ts`**

```ts
import { z } from 'zod'

export const profileSchema = z.object({
  contact: z.object({
    email: z.string().email(),
    phone: z.string(),
    location: z.string(),
  }),
  workAuth: z.object({
    authorized: z.boolean(),
    requiresSponsorship: z.boolean(),
  }),
  experienceYears: z.number().nonnegative(),
  salaryExpectation: z.object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
    currency: z.string(),
  }),
  links: z.object({
    linkedin: z.string(),
    github: z.string(),
    portfolio: z.string(),
  }),
  answers: z.record(z.string(), z.string()).default({}),
})

export type ProfileData = z.infer<typeof profileSchema>
```

- [ ] **Step 4: Create `src/profile/loader.ts`**

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { profileSchema, type ProfileData } from './profile.schema.ts'

export async function loadResume(path: string): Promise<string> {
  return readFile(path, 'utf-8')
}

export async function loadProfile(path: string): Promise<ProfileData> {
  const raw = await readFile(path, 'utf-8')
  return profileSchema.parse(JSON.parse(raw))
}

export async function saveLearnedAnswer(path: string, question: string, answer: string): Promise<void> {
  const profile = await loadProfile(path)
  profile.answers[question] = answer
  await writeFile(path, JSON.stringify(profile, null, 2))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/profile/loader.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Create example data files**

`resume.example.md`:
```markdown
# Jane Doe

Senior Full-Stack Engineer, 5 years experience. React, Node.js, TypeScript, Postgres.

## Experience

- Acme Corp (2021-2026): Led backend platform team, built job-queue infra handling 1M+ jobs/day.

## Education

- BS Computer Science, State University
```

`profile.example.json`:
```json
{
  "contact": { "email": "jaswanthjas20@gmail.com", "phone": "", "location": "" },
  "workAuth": { "authorized": true, "requiresSponsorship": false },
  "experienceYears": 5,
  "salaryExpectation": { "min": 0, "max": 0, "currency": "USD" },
  "links": { "linkedin": "", "github": "", "portfolio": "" },
  "answers": {}
}
```

- [ ] **Step 7: Commit**

```bash
git add src/profile/profile.schema.ts src/profile/loader.ts resume.example.md profile.example.json tests/unit/profile/loader.test.ts
git commit -m "feat(profile): add resume.md + profile.json data model"
```

---

### Task 4: Postgres database layer

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`
- Test: `tests/unit/db/schema.test.ts`

**Interfaces:**
- Consumes: `process.env.DATABASE_URL` (from `.env`, Task 1).
- Produces (consumed by Phase 2/3/4 later — not used elsewhere in Phase 1):
  ```ts
  function getDb(): NodePgDatabase<typeof schema>
  const jobs: PgTable        // id, title, company, location, applyUrl, applyType, sourceUrl, status, relevanceReason, createdAt, updatedAt
  const applications: PgTable // id, jobId, status, result, screenshotPath, error, createdAt
  const searchRuns: PgTable   // id, startedAt, finishedAt, urlsTried (jsonb), scannedCount, relevantCount, skippedCount
  ```

- [ ] **Step 1: Create `src/db/schema.ts`**

```ts
import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location'),
  applyUrl: text('apply_url').notNull(),
  applyType: text('apply_type', { enum: ['easy', 'external'] }).notNull(),
  sourceUrl: text('source_url').notNull(),
  status: text('status', {
    enum: ['discovered', 'queued', 'needs_input', 'applied', 'failed', 'skipped'],
  }).notNull().default('discovered'),
  relevanceReason: text('relevance_reason'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const applications = pgTable('applications', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id),
  status: text('status', { enum: ['applied', 'failed', 'needs_input'] }).notNull(),
  result: text('result'),
  screenshotPath: text('screenshot_path'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const searchRuns = pgTable('search_runs', {
  id: text('id').primaryKey(),
  startedAt: timestamp('started_at').defaultNow(),
  finishedAt: timestamp('finished_at'),
  urlsTried: jsonb('urls_tried').$type<string[]>().notNull().default([]),
  scannedCount: integer('scanned_count').notNull().default(0),
  relevantCount: integer('relevant_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
})
```

- [ ] **Step 2: Create `src/db/index.ts`**

```ts
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
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/linkedin_auto',
  },
})
```

- [ ] **Step 4: Start Postgres and push the schema**

Run: `docker compose up -d postgres`
Expected: `postgres` container starts and becomes healthy (`docker compose ps` shows it running on `5432`).

Run: `bun run db:push`
Expected: drizzle-kit reports `jobs`, `applications`, `search_runs` created, no errors.

- [ ] **Step 5: Write and run an integration test against the real local Postgres**

Create `tests/unit/db/schema.test.ts`:

```ts
import { describe, test, expect, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { getDb, closeDb } from '../../../src/db/index.ts'
import { jobs } from '../../../src/db/schema.ts'

describe('db schema', () => {
  afterAll(async () => {
    await closeDb()
  })

  test('inserts and reads back a job row', async () => {
    const db = getDb()
    await db.insert(jobs).values({
      id: 'test-job-1',
      title: 'Senior Engineer',
      company: 'Acme',
      applyUrl: 'https://linkedin.com/jobs/view/1',
      applyType: 'easy',
      sourceUrl: 'https://linkedin.com/jobs/search/?keywords=engineer',
    }).onConflictDoNothing()

    const rows = await db.select().from(jobs).where(eq(jobs.id, 'test-job-1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('discovered')

    await db.delete(jobs).where(eq(jobs.id, 'test-job-1'))
  })
})
```

Run: `bun test tests/unit/db/schema.test.ts`
Expected: PASS (requires `docker compose up -d postgres` and `bun run db:push` from Step 4 to have run first).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/index.ts drizzle.config.ts tests/unit/db/schema.test.ts
git commit -m "feat(db): add Postgres schema (jobs, applications, search_runs) via drizzle"
```

---

### Task 5: Shared-browser bootstrap + login verification

**Files:**
- Create: `src/browser/session.ts`, `src/browser/verify-login.ts`
- Test: `tests/unit/browser/verify-login.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (consumed by Task 10's `src/index.ts`, and by Phase 2/3/4 agents later via `getSharedCdpUrl()`):
  ```ts
  function launchBootstrapBrowser(storageStatePath: string): Promise<BrowserManager>
  function getBrowserManager(): BrowserManager
  function getSharedCdpUrl(): string
  function openLoginTabs(linkedinUrl: string, gmailUrl: string): Promise<void>
  interface PageProbe { isVisible(selector: string): Promise<boolean> }
  function createPlaywrightProbe(page: Page): PageProbe
  function verifyLogin(manager: BrowserManager): Promise<{ linkedin: boolean; gmail: boolean }>
  ```

- [ ] **Step 1: Create `src/browser/session.ts`**

```ts
import { BrowserManager } from 'agent-browser'

let manager: BrowserManager | null = null

export async function launchBootstrapBrowser(storageStatePath: string): Promise<BrowserManager> {
  manager = new BrowserManager()
  await manager.launch({ headless: false, storageState: storageStatePath })
  return manager
}

export function getBrowserManager(): BrowserManager {
  if (!manager) throw new Error('Bootstrap browser not launched yet')
  return manager
}

export function getSharedCdpUrl(): string {
  const url = getBrowserManager().getCdpUrl()
  if (!url) throw new Error('Bootstrap browser has no CDP URL — launch() must complete first')
  return url
}

export async function openLoginTabs(linkedinUrl: string, gmailUrl: string): Promise<void> {
  const mgr = getBrowserManager()
  await mgr.navigate(linkedinUrl)
  await mgr.newTab()
  await mgr.navigate(gmailUrl)
}
```

- [ ] **Step 2: Write the failing test for the login-check logic**

Create `tests/unit/browser/verify-login.test.ts` (tests the *decision logic* against a fake `PageProbe` — no real browser, per the spec's "no e2e against real LinkedIn" rule):

```ts
import { describe, test, expect } from 'bun:test'
import { checkLinkedInLoggedIn, checkGmailLoggedIn, type PageProbe } from '../../../src/browser/verify-login.ts'

function fakeProbe(visibleSelectors: string[]): PageProbe {
  return {
    async isVisible(selector: string) {
      return visibleSelectors.includes(selector)
    },
  }
}

describe('verify-login', () => {
  test('checkLinkedInLoggedIn true when nav profile menu is visible', async () => {
    const probe = fakeProbe(['[data-control-name="nav.settings_profile"], .global-nav__me-photo'])
    expect(await checkLinkedInLoggedIn(probe)).toBe(true)
  })

  test('checkLinkedInLoggedIn false when only the login form is visible', async () => {
    const probe = fakeProbe(['#username'])
    expect(await checkLinkedInLoggedIn(probe)).toBe(false)
  })

  test('checkGmailLoggedIn true when inbox is visible', async () => {
    const probe = fakeProbe(['[gh="tl"]'])
    expect(await checkGmailLoggedIn(probe)).toBe(true)
  })

  test('checkGmailLoggedIn false when only the Google login form is visible', async () => {
    const probe = fakeProbe(['#identifierId'])
    expect(await checkGmailLoggedIn(probe)).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/browser/verify-login.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Create `src/browser/verify-login.ts`**

```ts
import type { Page } from 'playwright-core'
import type { BrowserManager } from 'agent-browser'

export interface PageProbe {
  isVisible(selector: string): Promise<boolean>
}

export function createPlaywrightProbe(page: Page): PageProbe {
  return {
    async isVisible(selector: string) {
      return page.locator(selector).first().isVisible().catch(() => false)
    },
  }
}

const LINKEDIN_LOGGED_IN_SELECTOR = '[data-control-name="nav.settings_profile"], .global-nav__me-photo'
const GMAIL_LOGGED_IN_SELECTOR = '[gh="tl"]'

export async function checkLinkedInLoggedIn(probe: PageProbe): Promise<boolean> {
  return probe.isVisible(LINKEDIN_LOGGED_IN_SELECTOR)
}

export async function checkGmailLoggedIn(probe: PageProbe): Promise<boolean> {
  return probe.isVisible(GMAIL_LOGGED_IN_SELECTOR)
}

export async function verifyLogin(manager: BrowserManager): Promise<{ linkedin: boolean; gmail: boolean }> {
  const pages = manager.getPages()
  const linkedinPage = pages[0]
  const gmailPage = pages[1]

  const linkedin = linkedinPage ? await checkLinkedInLoggedIn(createPlaywrightProbe(linkedinPage)) : false
  const gmail = gmailPage ? await checkGmailLoggedIn(createPlaywrightProbe(gmailPage)) : false

  return { linkedin, gmail }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/browser/verify-login.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/browser/session.ts src/browser/verify-login.ts tests/unit/browser/verify-login.test.ts
git commit -m "feat(browser): shared-browser bootstrap via agent-browser BrowserManager + login verification"
```

---

### Task 6: App state store

**Files:**
- Create: `src/state/types.ts`, `src/state/app-state.ts`
- Test: `tests/unit/state/app-state.test.ts`

**Interfaces:**
- Consumes: `AppConfig['search']['irrelevantBailRatio']`, `AppConfig['concurrency']`, `AppConfig['model']` (Task 2) as initial `settings`.
- Produces (consumed by Task 7 commands, Task 8/9 TUI components, Task 10 entrypoint):
  ```ts
  type TabId = 'search' | 'easy' | 'external'
  type AgentStatus = 'idle' | 'running' | 'needs_input'
  interface TabState { status: AgentStatus; step: string | null; logs: string[]; needsInputQuestion: string | null }
  interface SessionStatus { linkedin: boolean; gmail: boolean }
  interface Settings { concurrency: number; model: string; irrelevantBailRatio: number }

  function initAppState(settings: Settings): void
  const appState: { session: SessionStatus; activeTab: TabId; tabs: Record<TabId, TabState>; settings: Settings } // Solid store, read-only from outside
  function setSessionStatus(service: 'linkedin' | 'gmail', connected: boolean): void
  function isUnlocked(): boolean
  function setActiveTab(tab: TabId): void
  function pushLog(tab: TabId, line: string): void
  function setAgentStatus(tab: TabId, status: AgentStatus, step?: string | null): void
  function setNeedsInput(tab: TabId, question: string | null): void
  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void
  ```

- [ ] **Step 1: Create `src/state/types.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/state/app-state.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  initAppState,
  appState,
  setSessionStatus,
  isUnlocked,
  setActiveTab,
  pushLog,
  setAgentStatus,
  setNeedsInput,
} from '../../../src/state/app-state.ts'

beforeEach(() => {
  initAppState({ concurrency: 1, model: 'test-model', irrelevantBailRatio: 0.5 })
})

describe('app-state', () => {
  test('starts locked with both sessions disconnected', () => {
    expect(isUnlocked()).toBe(false)
    expect(appState.session.linkedin).toBe(false)
    expect(appState.session.gmail).toBe(false)
  })

  test('unlocks only when both linkedin and gmail are connected', () => {
    setSessionStatus('linkedin', true)
    expect(isUnlocked()).toBe(false)
    setSessionStatus('gmail', true)
    expect(isUnlocked()).toBe(true)
  })

  test('setActiveTab updates activeTab', () => {
    setActiveTab('easy')
    expect(appState.activeTab).toBe('easy')
  })

  test('pushLog appends to the given tab only', () => {
    pushLog('search', 'scanning page 1')
    expect(appState.tabs.search.logs).toEqual(['scanning page 1'])
    expect(appState.tabs.easy.logs).toEqual([])
  })

  test('pushLog caps log history at MAX_LOGS_PER_TAB', () => {
    for (let i = 0; i < 510; i++) pushLog('search', `line ${i}`)
    expect(appState.tabs.search.logs.length).toBe(500)
    expect(appState.tabs.search.logs[499]).toBe('line 509')
  })

  test('setAgentStatus updates status and step', () => {
    setAgentStatus('easy', 'running', 'applying to job 3')
    expect(appState.tabs.easy.status).toBe('running')
    expect(appState.tabs.easy.step).toBe('applying to job 3')
  })

  test('setNeedsInput sets and clears the pending question', () => {
    setNeedsInput('external', 'What is your visa status?')
    expect(appState.tabs.external.needsInputQuestion).toBe('What is your visa status?')
    setNeedsInput('external', null)
    expect(appState.tabs.external.needsInputQuestion).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/state/app-state.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Create `src/state/app-state.ts`**

```ts
import { createStore, produce } from 'solid-js/store'
import { TAB_IDS, MAX_LOGS_PER_TAB, type AppState, type TabId, type AgentStatus, type Settings } from './types.ts'

function emptyTabState() {
  return { status: 'idle' as AgentStatus, step: null, logs: [], needsInputQuestion: null }
}

function initialState(settings: Settings): AppState {
  return {
    session: { linkedin: false, gmail: false },
    activeTab: 'search',
    tabs: {
      search: emptyTabState(),
      easy: emptyTabState(),
      external: emptyTabState(),
    },
    settings,
  }
}

export let [appState, setAppStateInternal] = createStore<AppState>(
  initialState({ concurrency: 1, model: '', irrelevantBailRatio: 0.5 }),
)

export function initAppState(settings: Settings): void {
  ;[appState, setAppStateInternal] = createStore<AppState>(initialState(settings))
}

export function setSessionStatus(service: 'linkedin' | 'gmail', connected: boolean): void {
  setAppStateInternal('session', service, connected)
}

export function isUnlocked(): boolean {
  return appState.session.linkedin && appState.session.gmail
}

export function setActiveTab(tab: TabId): void {
  setAppStateInternal('activeTab', tab)
}

export function pushLog(tab: TabId, line: string): void {
  setAppStateInternal(
    'tabs',
    tab,
    'logs',
    produce((logs) => {
      logs.push(line)
      if (logs.length > MAX_LOGS_PER_TAB) logs.splice(0, logs.length - MAX_LOGS_PER_TAB)
    }),
  )
}

export function setAgentStatus(tab: TabId, status: AgentStatus, step: string | null = null): void {
  setAppStateInternal('tabs', tab, { status, step })
}

export function setNeedsInput(tab: TabId, question: string | null): void {
  setAppStateInternal('tabs', tab, 'needsInputQuestion', question)
  if (question) setAppStateInternal('tabs', tab, 'status', 'needs_input')
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  setAppStateInternal('settings', key, value)
}

export { TAB_IDS }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/state/app-state.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/state/types.ts src/state/app-state.ts tests/unit/state/app-state.test.ts
git commit -m "feat(state): add Solid-store app state (session/tabs/settings)"
```

---

### Task 7: Command registry + global/stub commands

**Files:**
- Create: `src/commands/types.ts`, `src/commands/registry.ts`, `src/commands/dispatch.ts`, `src/commands/global-commands.ts`, `src/commands/stub-commands.ts`
- Test: `tests/unit/commands/registry.test.ts`, `tests/unit/commands/dispatch.test.ts`

**Interfaces:**
- Consumes: `appState`, `setSessionStatus`, `isUnlocked`, `setActiveTab`, `pushLog`, `setSetting`, `TAB_IDS` (Task 6); `getBrowserManager`, `getBrowserManager` usage for `/verify-login` (Task 5).
- Produces (consumed by Task 9's `InputBar`/`App`, Task 10's entrypoint):
  ```ts
  type CommandScope = 'global' | TabId
  interface CommandContext { args: string[]; rawArgs: string }
  interface Command { name: string; scope: CommandScope; description: string; run(ctx: CommandContext): Promise<void> | void }
  function registerCommand(cmd: Command): void
  function getCommand(name: string): Command | undefined
  function listCommandsForTab(tab: TabId): Command[]
  function dispatchCommand(input: string): Promise<void>
  function registerBuiltinCommands(): void  // registers global + stub commands, called once at startup
  ```

- [ ] **Step 1: Create `src/commands/types.ts`**

```ts
import type { TabId } from '../state/types.ts'

export type CommandScope = 'global' | TabId

export interface CommandContext {
  args: string[]
  rawArgs: string
}

export interface Command {
  name: string
  scope: CommandScope
  description: string
  run(ctx: CommandContext): Promise<void> | void
}
```

- [ ] **Step 2: Write the failing test for the registry**

Create `tests/unit/commands/registry.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test'
import { registerCommand, getCommand, listCommandsForTab, clearRegistryForTest } from '../../../src/commands/registry.ts'
import type { Command } from '../../../src/commands/types.ts'

beforeEach(() => {
  clearRegistryForTest()
})

describe('command registry', () => {
  test('registers and retrieves a command by name', () => {
    const cmd: Command = { name: 'help', scope: 'global', description: 'help', run: () => {} }
    registerCommand(cmd)
    expect(getCommand('help')).toBe(cmd)
  })

  test('listCommandsForTab includes global and tab-scoped commands, excludes other tabs', () => {
    registerCommand({ name: 'help', scope: 'global', description: '', run: () => {} })
    registerCommand({ name: 'search-urls', scope: 'search', description: '', run: () => {} })
    registerCommand({ name: 'process-easy-queue', scope: 'easy', description: '', run: () => {} })

    const searchCommands = listCommandsForTab('search').map((c) => c.name)
    expect(searchCommands).toContain('help')
    expect(searchCommands).toContain('search-urls')
    expect(searchCommands).not.toContain('process-easy-queue')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/commands/registry.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Create `src/commands/registry.ts`**

```ts
import type { Command } from './types.ts'
import type { TabId } from '../state/types.ts'

const commands = new Map<string, Command>()

export function registerCommand(cmd: Command): void {
  commands.set(cmd.name, cmd)
}

export function getCommand(name: string): Command | undefined {
  return commands.get(name)
}

export function listCommandsForTab(tab: TabId): Command[] {
  return Array.from(commands.values()).filter((c) => c.scope === 'global' || c.scope === tab)
}

export function clearRegistryForTest(): void {
  commands.clear()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/commands/registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Create `src/commands/global-commands.ts`**

```ts
import { registerCommand } from './registry.ts'
import { listCommandsForTab } from './registry.ts'
import { appState, setSessionStatus, setActiveTab, setSetting, pushLog, TAB_IDS } from '../state/app-state.ts'
import type { TabId, Settings } from '../state/types.ts'
import { getBrowserManager } from '../browser/session.ts'
import { verifyLogin } from '../browser/verify-login.ts'

export function registerGlobalCommands(): void {
  registerCommand({
    name: 'help',
    scope: 'global',
    description: 'List available commands for the active tab',
    run: () => {
      const list = listCommandsForTab(appState.activeTab)
      pushLog(appState.activeTab, `Commands: ${list.map((c) => '/' + c.name).join(', ')}`)
    },
  })

  registerCommand({
    name: 'tab',
    scope: 'global',
    description: '/tab search|easy|external — switch active tab',
    run: (ctx) => {
      const target = ctx.args[0] as TabId | undefined
      if (!target || !TAB_IDS.includes(target)) {
        pushLog(appState.activeTab, `Usage: /tab ${TAB_IDS.join('|')}`)
        return
      }
      setActiveTab(target)
    },
  })

  registerCommand({
    name: 'set',
    scope: 'global',
    description: '/set <concurrency|model|irrelevantBailRatio> <value>',
    run: (ctx) => {
      const [key, ...rest] = ctx.args
      const value = rest.join(' ')
      if (key === 'concurrency') setSetting('concurrency', Number(value))
      else if (key === 'model') setSetting('model', value)
      else if (key === 'irrelevantBailRatio') setSetting('irrelevantBailRatio', Number(value))
      else {
        pushLog(appState.activeTab, `Unknown setting: ${key}. Use concurrency, model, or irrelevantBailRatio.`)
        return
      }
      pushLog(appState.activeTab, `Set ${key} = ${value}`)
    },
  })

  registerCommand({
    name: 'verify-login',
    scope: 'global',
    description: 'Check LinkedIn + Gmail login status in the bootstrap browser',
    run: async () => {
      const manager = getBrowserManager()
      const result = await verifyLogin(manager)
      setSessionStatus('linkedin', result.linkedin)
      setSessionStatus('gmail', result.gmail)
      if (result.linkedin && result.gmail) {
        pushLog(appState.activeTab, 'Login verified: LinkedIn + Gmail connected.')
      } else {
        const missing = [!result.linkedin && 'LinkedIn', !result.gmail && 'Gmail'].filter(Boolean).join(', ')
        pushLog(appState.activeTab, `Not logged in yet: ${missing}. Log in in the browser window, then run /verify-login again.`)
      }
    },
  })
}
```

- [ ] **Step 7: Create `src/commands/stub-commands.ts`**

```ts
import { registerCommand } from './registry.ts'
import { pushLog } from '../state/app-state.ts'
import type { TabId } from '../state/types.ts'

function stub(name: string, scope: TabId, phase: number, description: string) {
  registerCommand({
    name,
    scope,
    description,
    run: () => {
      pushLog(scope, `/${name} is not implemented yet — arrives in Phase ${phase}.`)
    },
  })
}

export function registerStubCommands(): void {
  stub('search-urls', 'search', 2, 'Run configured LinkedIn search URLs')
  stub('search-describe', 'search', 2, 'Describe the jobs you want in free text')
  stub('search-resume', 'search', 2, 'Infer search filters from resume.md')
  stub('process-easy-queue', 'easy', 3, 'Start processing the Easy Apply queue')
  stub('process-external-queue', 'external', 4, 'Start processing the external-apply queue')
}
```

- [ ] **Step 8: Write the failing test for dispatch (lock behavior)**

Create `tests/unit/commands/dispatch.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test'
import { clearRegistryForTest, registerCommand } from '../../../src/commands/registry.ts'
import { dispatchCommand } from '../../../src/commands/dispatch.ts'
import { initAppState, appState, setSessionStatus, pushLog } from '../../../src/state/app-state.ts'

beforeEach(() => {
  clearRegistryForTest()
  initAppState({ concurrency: 1, model: 'test', irrelevantBailRatio: 0.5 })
  registerCommand({ name: 'help', scope: 'global', description: '', run: () => {} })
  registerCommand({
    name: 'search-urls',
    scope: 'search',
    description: '',
    // Uses the real pushLog API rather than mutating the Solid store's array
    // directly — direct .push() on a store-derived array doesn't persist
    // through Solid's store proxy (confirmed while validating this plan).
    run: () => {
      pushLog('search', 'ran')
    },
  })
})

describe('dispatchCommand', () => {
  test('runs global commands before login is verified', async () => {
    await expect(dispatchCommand('/help')).resolves.toBeUndefined()
  })

  test('rejects tab-scoped commands before login is verified', async () => {
    await dispatchCommand('/search-urls')
    expect(appState.tabs.search.logs.some((l) => l.includes('log in') || l.includes('verify-login'))).toBe(true)
    expect(appState.tabs.search.logs).not.toContain('ran')
  })

  test('allows tab-scoped commands once both sessions are connected', async () => {
    setSessionStatus('linkedin', true)
    setSessionStatus('gmail', true)
    await dispatchCommand('/search-urls')
    expect(appState.tabs.search.logs).toContain('ran')
  })

  test('unknown command logs an error to the active tab', async () => {
    await dispatchCommand('/nonexistent')
    expect(appState.tabs.search.logs.some((l) => l.includes('Unknown command'))).toBe(true)
  })
})
```

- [ ] **Step 9: Run test to verify it fails**

Run: `bun test tests/unit/commands/dispatch.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 10: Create `src/commands/dispatch.ts`**

```ts
import { getCommand } from './registry.ts'
import { appState, pushLog, isUnlocked } from '../state/app-state.ts'

export async function dispatchCommand(input: string): Promise<void> {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    pushLog(appState.activeTab, `Not a command: ${trimmed}. Commands start with /.`)
    return
  }

  const [rawName, ...args] = trimmed.slice(1).split(/\s+/)
  const name = rawName ?? ''
  const command = getCommand(name)

  if (!command) {
    pushLog(appState.activeTab, `Unknown command: /${name}. Try /help.`)
    return
  }

  if (command.scope !== 'global' && !isUnlocked()) {
    pushLog(appState.activeTab, `/${name} is locked until login is verified. Log in in the browser window, then run /verify-login.`)
    return
  }

  try {
    await command.run({ args, rawArgs: args.join(' ') })
  } catch (err) {
    pushLog(appState.activeTab, `/${name} failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `bun test tests/unit/commands/dispatch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 12: Commit**

```bash
git add src/commands tests/unit/commands
git commit -m "feat(commands): add registry, dispatch with login-lock, global + stub commands"
```

---

### Task 8: TUI theme + presentational components

**Files:**
- Create: `src/tui/theme.ts`, `src/tui/components/Header.tsx`, `src/tui/components/Sidebar.tsx`, `src/tui/components/LogPanel.tsx`, `src/tui/components/InputBar.tsx`
- Test: `tests/unit/tui/components.test.tsx`

**Interfaces:**
- Consumes: `appState`, `TabId`, `TAB_IDS` (Task 6).
- Produces (consumed by Task 9's `App.tsx`):
  ```ts
  const theme: { background, backgroundPanel, text, textMuted, border, accent, secondary, success, warning, error: string }
  function Header(): JSX.Element
  function Sidebar(): JSX.Element
  function LogPanel(props: { tab: TabId }): JSX.Element
  function InputBar(props: { onSubmit: (value: string) => void; disabled?: boolean }): JSX.Element
  ```

- [ ] **Step 1: Create `src/tui/theme.ts`** (colors taken from opencode's own default dark theme, `packages/tui/src/theme/assets/opencode.json`)

```ts
export const theme = {
  background: '#0a0a0a',
  backgroundPanel: '#141414',
  border: '#3c3c3c',
  text: '#eeeeee',
  textMuted: '#808080',
  accent: '#fab283',
  secondary: '#5c9cf5',
  success: '#7fd88f',
  warning: '#e5c07b',
  error: '#e06c75',
}
```

- [ ] **Step 2: Create `src/tui/components/Header.tsx`**

```tsx
import { appState } from '../../state/app-state.ts'
import { theme } from '../theme.ts'

export function Header() {
  const statusText = () => {
    const s = appState.session
    if (s.linkedin && s.gmail) return 'LinkedIn + Gmail connected'
    const waiting = [!s.linkedin && 'LinkedIn', !s.gmail && 'Gmail'].filter(Boolean).join(' + ')
    return `Waiting for login: ${waiting}`
  }

  return (
    <box border borderColor={theme.border} paddingLeft={1} paddingRight={1} height={3}>
      <text fg={theme.text}>LinkedIn Auto-Apply — {statusText()}</text>
    </box>
  )
}
```

- [ ] **Step 3: Create `src/tui/components/Sidebar.tsx`**

```tsx
import { For, Show } from 'solid-js'
import { TextAttributes } from '@opentui/core'
import { appState, TAB_IDS } from '../../state/app-state.ts'
import { theme } from '../theme.ts'
import type { TabId } from '../../state/types.ts'

const TAB_LABELS: Record<TabId, string> = {
  search: 'Search',
  easy: 'Easy Apply',
  external: 'External Apply',
}

export function Sidebar() {
  return (
    <scrollbox border borderColor={theme.border} width={30} flexDirection="column" padding={1} scrollY>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>Session</text>
      <text fg={appState.session.linkedin ? theme.success : theme.textMuted}>
        LinkedIn: {appState.session.linkedin ? 'connected' : 'waiting'}
      </text>
      <text fg={appState.session.gmail ? theme.success : theme.textMuted}>
        Gmail: {appState.session.gmail ? 'connected' : 'waiting'}
      </text>

      <text fg={theme.text}> </text>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>Agents</text>
      <For each={TAB_IDS}>
        {(tab) => (
          <box flexDirection="column">
            <text
              fg={appState.tabs[tab].status === 'needs_input' ? theme.warning : theme.text}
              bg={appState.activeTab === tab ? theme.backgroundPanel : undefined}
            >
              {TAB_LABELS[tab]}: {appState.tabs[tab].status}
              {appState.tabs[tab].status === 'needs_input' ? ' ⚠' : ''}
            </text>
            <Show when={appState.tabs[tab].step}>
              <text fg={theme.textMuted}>  {appState.tabs[tab].step}</text>
            </Show>
            <Show when={appState.tabs[tab].needsInputQuestion}>
              <text fg={theme.warning}>  ? {appState.tabs[tab].needsInputQuestion}</text>
            </Show>
          </box>
        )}
      </For>
    </scrollbox>
  )
}
```

- [ ] **Step 4: Create `src/tui/components/LogPanel.tsx`**

```tsx
import { For } from 'solid-js'
import { appState } from '../../state/app-state.ts'
import { theme } from '../theme.ts'
import type { TabId } from '../../state/types.ts'

export function LogPanel(props: { tab: TabId }) {
  return (
    <scrollbox border borderColor={theme.border} flexDirection="column" padding={1} scrollY stickyScroll stickyStart="bottom">
      <For each={appState.tabs[props.tab].logs}>{(line) => <text fg={theme.text}>{line}</text>}</For>
    </scrollbox>
  )
}
```

- [ ] **Step 5: Create `src/tui/components/InputBar.tsx`**

```tsx
import { createSignal } from 'solid-js'
import { theme } from '../theme.ts'

export function InputBar(props: { onSubmit: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = createSignal('')

  return (
    <box border borderColor={theme.border} height={3} paddingLeft={1} paddingRight={1}>
      <input
        value={value()}
        placeholder={props.disabled ? 'Waiting for browser login...' : 'Type a /command'}
        onInput={setValue}
        onSubmit={(v) => {
          if (!v.trim()) return
          props.onSubmit(v)
          setValue('')
        }}
      />
    </box>
  )
}
```

- [ ] **Step 6: Write and run the component test**

Create `tests/unit/tui/components.test.tsx`:

```tsx
import { describe, test, expect, beforeEach } from 'bun:test'
import { testRender } from '@opentui/solid'
import { initAppState, setSessionStatus, setAgentStatus, setNeedsInput, pushLog } from '../../../src/state/app-state.ts'
import { Header } from '../../../src/tui/components/Header.tsx'
import { Sidebar } from '../../../src/tui/components/Sidebar.tsx'
import { LogPanel } from '../../../src/tui/components/LogPanel.tsx'

beforeEach(() => {
  initAppState({ concurrency: 1, model: 'test', irrelevantBailRatio: 0.5 })
})

describe('TUI components', () => {
  test('Header shows waiting state, then connected state', async () => {
    const setup = await testRender(() => <Header />, { width: 60, height: 5 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain('Waiting for login')

    setSessionStatus('linkedin', true)
    setSessionStatus('gmail', true)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain('connected')
  })

  test('Sidebar highlights a tab with a pending question', async () => {
    setNeedsInput('easy', 'What is your notice period?')
    const setup = await testRender(() => <Sidebar />, { width: 30, height: 20 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain('needs_input')
    // Sidebar is narrow enough that long questions wrap across lines — assert
    // on a short, guaranteed-unwrapped prefix rather than the full sentence.
    expect(frame).toContain('What is your notice')
  })

  test('LogPanel renders only the given tab\'s log lines', async () => {
    pushLog('search', 'scanning linkedin.com/jobs')
    pushLog('easy', 'applying to job 1')
    const setup = await testRender(() => <LogPanel tab="search" />, { width: 60, height: 10 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain('scanning linkedin.com/jobs')
    expect(frame).not.toContain('applying to job 1')
  })
})
```

Run: `bun test tests/unit/tui/components.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/tui/theme.ts src/tui/components tests/unit/tui/components.test.tsx
git commit -m "feat(tui): add theme + Header/Sidebar/LogPanel/InputBar components"
```

---

### Task 9: App composition, tab switching, responsive layout

**Files:**
- Create: `src/tui/App.tsx`, `src/tui/index.tsx`
- Test: `tests/unit/tui/app.test.tsx`

**Interfaces:**
- Consumes: `Header`, `Sidebar`, `LogPanel`, `InputBar`, `theme` (Task 8); `appState`, `setActiveTab`, `TAB_IDS` (Task 6); `dispatchCommand` (Task 7).
- Produces (consumed by Task 10's `src/index.ts`):
  ```ts
  function App(): JSX.Element
  function mountTui(): Promise<void>
  ```

- [ ] **Step 1: Create `src/tui/App.tsx`**

```tsx
import { createMemo } from 'solid-js'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { appState, setActiveTab, TAB_IDS } from '../state/app-state.ts'
import { dispatchCommand } from '../commands/dispatch.ts'
import { Header } from './components/Header.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { LogPanel } from './components/LogPanel.tsx'
import { InputBar } from './components/InputBar.tsx'
import { theme } from './theme.ts'

const NARROW_WIDTH_THRESHOLD = 70

export function App() {
  const dimensions = useTerminalDimensions()
  const isNarrow = createMemo(() => dimensions().width < NARROW_WIDTH_THRESHOLD)

  useKeyboard((key) => {
    if (key.name === 'tab') {
      const currentIndex = TAB_IDS.indexOf(appState.activeTab)
      const nextIndex = key.shift
        ? (currentIndex - 1 + TAB_IDS.length) % TAB_IDS.length
        : (currentIndex + 1) % TAB_IDS.length
      setActiveTab(TAB_IDS[nextIndex]!)
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.background}>
      <Header />
      <box flexDirection="row" flexGrow={1}>
        <box width={isNarrow() ? 12 : 30}>
          <Sidebar />
        </box>
        <box flexDirection="column" flexGrow={1}>
          <LogPanel tab={appState.activeTab} />
        </box>
      </box>
      <InputBar disabled={!appState.session.linkedin || !appState.session.gmail} onSubmit={dispatchCommand} />
    </box>
  )
}
```

- [ ] **Step 2: Create `src/tui/index.tsx`**

Bun's transform does not accept JSX syntax inside a plain `.ts` file (confirmed while validating this plan — `bun build` fails to parse `<box>` in a `.ts` file, misreading `<`/`>` as comparison/generic tokens). This file must be `.tsx`.

```tsx
import { render } from '@opentui/solid'
import { App } from './App.tsx'

export async function mountTui(): Promise<void> {
  await render(() => <App />)
}
```

- [ ] **Step 3: Write and run the composition/responsiveness test**

Create `tests/unit/tui/app.test.tsx`:

```tsx
import { describe, test, expect, beforeEach } from 'bun:test'
import { testRender } from '@opentui/solid'
import { initAppState, setActiveTab, setSessionStatus, pushLog } from '../../../src/state/app-state.ts'
import { App } from '../../../src/tui/App.tsx'

beforeEach(() => {
  initAppState({ concurrency: 1, model: 'test', irrelevantBailRatio: 0.5 })
})

describe('App', () => {
  test('renders header, sidebar, and the active tab\'s log panel', async () => {
    pushLog('search', 'scan started')
    const setup = await testRender(() => <App />, { width: 100, height: 30 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain('LinkedIn Auto-Apply')
    expect(frame).toContain('Agents')
    expect(frame).toContain('scan started')
  })

  test('switching active tab changes which log panel is visible', async () => {
    pushLog('search', 'search log line')
    pushLog('easy', 'easy log line')
    const setup = await testRender(() => <App />, { width: 100, height: 30 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain('search log line')

    setActiveTab('easy')
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain('easy log line')
    expect(frame).not.toContain('search log line')
  })

  test('resizing to a narrow terminal shrinks the sidebar without crashing', async () => {
    const setup = await testRender(() => <App />, { width: 100, height: 30 })
    await setup.renderOnce()
    setup.resize(50, 30)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame.length).toBeGreaterThan(0)
  })

  test('input box is disabled (shows waiting placeholder) until both sessions connect', async () => {
    const setup = await testRender(() => <App />, { width: 100, height: 30 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain('Waiting for browser login')

    setSessionStatus('linkedin', true)
    setSessionStatus('gmail', true)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain('Type a /command')
  })
})
```

Run: `bun test tests/unit/tui/app.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add src/tui/App.tsx src/tui/index.tsx tests/unit/tui/app.test.tsx
git commit -m "feat(tui): compose App shell with tab cycling and responsive sidebar"
```

---

### Task 10: Wire up the entrypoint (`src/index.ts`)

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes everything produced by Tasks 2–9: `loadConfig` (2), `loadResume`/`loadProfile` (3), `getDb` (4), `launchBootstrapBrowser`/`openLoginTabs` (5), `initAppState`/`pushLog` (6), `registerGlobalCommands`/`registerStubCommands` (7), `mountTui` (9).
- Produces: nothing further — this is the composition root.

- [ ] **Step 1: Create `src/index.ts`**

```ts
import { ensureDataDir, createLogger, logger } from './utils/logger.ts'
import { loadConfig } from './config/loader.ts'
import { loadResume, loadProfile } from './profile/loader.ts'
import { getDb } from './db/index.ts'
import { launchBootstrapBrowser, openLoginTabs } from './browser/session.ts'
import { initAppState } from './state/app-state.ts'
import { registerGlobalCommands } from './commands/global-commands.ts'
import { registerStubCommands } from './commands/stub-commands.ts'
import { mountTui } from './tui/index.tsx'

async function main() {
  ensureDataDir()
  createLogger()

  const config = await loadConfig()

  // Fail fast on bad profile data, before the browser opens.
  await loadResume(config.profileFiles.resume)
  await loadProfile(config.profileFiles.profile)

  getDb()

  initAppState({
    concurrency: config.concurrency,
    model: config.model,
    irrelevantBailRatio: config.search.irrelevantBailRatio,
  })

  registerGlobalCommands()
  registerStubCommands()

  await launchBootstrapBrowser('./data/browser-storage-state.json')
  await openLoginTabs('https://www.linkedin.com/login', 'https://mail.google.com')

  await mountTui()
}

main().catch((err) => {
  logger.error(err)
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Typecheck the full project**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `docker compose up -d` (ensures Postgres + Redis are up for the DB test from Task 4)
Run: `bun test`
Expected: all tests pass (smoke, path, screenshot, logger, config, profile, db, verify-login, app-state, registry, dispatch, components, app).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up entrypoint — config, profile, db, browser bootstrap, TUI"
```

---

### Task 11: Manual end-to-end walkthrough + docs

**Files:**
- Modify: `README.md`

**Interfaces:** none (verification + documentation task).

- [ ] **Step 1: Prepare local data files**

```bash
cp resume.example.md resume.md
cp profile.example.json profile.json
```

Edit `profile.json` to fill in your real contact info (email `jaswanthjas20@gmail.com` is already the example default) — this file is real personal data, so confirm it's covered by `.gitignore` before editing.

Run: `grep -q "^profile.json$\|^resume.md$" .gitignore || echo "profile.json and resume.md are NOT gitignored — add them before continuing"`

If they're not listed, add `profile.json` and `resume.md` to `.gitignore` now.

- [ ] **Step 2: Start infrastructure**

Run: `docker compose up -d`
Expected: `redis` and `postgres` containers running (`docker compose ps`).

Run: `bun run db:push`
Expected: schema pushed without errors.

- [ ] **Step 3: Run the manual walkthrough**

Run: `bun run dev`

Verify, in order:
1. A visible Chrome window opens with two tabs: LinkedIn login, Gmail.
2. The TUI shows the header as "Waiting for login: LinkedIn + Gmail", sidebar shows both as "waiting", input box shows the "Waiting for browser login..." placeholder.
3. Log into LinkedIn and Gmail by hand in the browser window.
4. Back in the TUI, type `/verify-login` and press Enter.
5. Header flips to "LinkedIn + Gmail connected", sidebar shows both as "connected" (green), input placeholder changes to "Type a /command".
6. Press Tab / Shift+Tab — active tab cycles search → easy → external → search; sidebar highlights the active row; log panel switches content.
7. Type `/search-urls` while on the search tab — logs "not implemented yet — arrives in Phase 2" into the search tab's log panel.
8. Type `/tab easy`, then `/process-easy-queue` — logs the Phase 3 stub message into the easy tab.
9. Resize the terminal window narrower — layout doesn't crash, sidebar shrinks.
10. Press Ctrl+C — process exits cleanly.

- [ ] **Step 4: Update `README.md`**

```markdown
# LinkedIn Auto-Apply

A terminal agent that opens a real, visible browser, waits for you to log into LinkedIn and Gmail by hand, then searches and applies to jobs on your behalf — asking for input only when it genuinely needs it.

## Setup

1. `bun install`
2. `docker compose up -d` (Redis + Postgres)
3. `bun run db:push`
4. `cp resume.example.md resume.md` and `cp profile.example.json profile.json`, then fill in your real details. Both files are gitignored.
5. `bun run dev`

## Status

Phase 1 (this shell): TUI, shared-browser login bootstrap, command framework — done.
Phase 2 (search agent), Phase 3 (easy-apply agent), Phase 4 (external-apply agent): not yet implemented — see `docs/superpowers/specs/2026-07-14-tui-rebuild-design.md` for the full design.
```

- [ ] **Step 5: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: Phase 1 setup instructions and status"
```

---

## Definition of Done

- `bun install`, `bun run typecheck`, and `bun test` all succeed.
- `bun run dev` opens a visible browser with LinkedIn + Gmail tabs, and the full manual walkthrough in Task 11 Step 3 passes.
- No file in `src/` references headless mode, stores credentials, or launches a second browser instance.
