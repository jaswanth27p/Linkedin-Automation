# LinkedIn Auto-Apply: TUI Rebuild + Full Flow Design

Status: approved (2026-07-14)
Supersedes: relevant portions of `2026-07-01-linkedin-job-automation-design.md` (TUI layer, command model). Data model, queue, and browser-automation approach are extended, not replaced.

## Context

Existing implementation (`Linkedin-Automation/`) has real, salvageable logic (BullMQ queues, Mastra `AgentBrowser` agent construction, Drizzle schema, config/profile loaders, `NeedsInputError` pattern) but:

- TUI is Ink/React with single-letter shortcuts (`r`/`f`/`a`/`x`/`s`) — no command palette, no tabs, doesn't match desired opencode look.
- No login-bootstrap flow at all — nothing opens a visible browser and waits for manual LinkedIn/Gmail login before the rest of the flow can run.
- `docker-compose.yml` already provisions Postgres, but nothing in the codebase uses it — DB layer is actually sqlite/libsql. Dead config.
- No relevance-based early-bail logic during search (scan a page, bail if mostly irrelevant).
- No structured profile data — only a single free-text profile file, so form-filling on applications has nothing deterministic to key off.

This is a full-flow product: TUI shell, browser login bootstrap, search agent, easy-apply agent, external-apply agent. Broken into 4 phases below, specced in full now (per user request) so implementation phases don't lose context, but built and verified one phase at a time — Phase 1 first.

## Architecture Overview

**Runtime**: Bun + TypeScript throughout (TUI, agents, workers). Replaces old Node/tsx setup — required for `@opentui/solid` anyway, matches opencode's own runtime.

**Process model**: single Bun process. TUI (`@opentui/solid`) drives an `AppState` store (Solid signals/stores, reactive — replaces the old manual `EventEmitter` + `subscribe` bus). Orchestrator + BullMQ workers run in the same process. The old `src/server.ts` (separate HTTP server) is dropped — dead weight for a single-user local TUI app.

**Browser**: one Mastra `AgentBrowser` instance, one browser context, created at TUI startup — **always visible, `headless: false` hardcoded, no toggle**. Login bootstrap opens two tabs (LinkedIn, Gmail) in that context. All later agents (search, easy-apply, external-apply) get pages from this *same* context via a shared `BrowserSession` helper, so cookies/login state carry over to every tab. A mutex (evolution of old `utils/mutex.ts`) serializes actions on any single page; different agents can hold different tabs concurrently.

**Queues**: BullMQ + Redis (kept as-is). Search queue produces jobs; jobs route to `easy-apply` or `external-apply` queue by `applyType`. Each queue's worker runs `concurrency: 1` — strictly one application at a time, matching "apply one by one."

**DB**: Postgres via Drizzle, replacing sqlite/libsql (docker-compose already provisions Postgres — just get wired up for real this time).

**Data files** (user-edited, agent-read, agent-updates `answers` over time):
- `resume.md` — free text, used for relevance judging, tailoring, and as LLM context for free-text form questions.
- `profile.json` — structured (contact info incl. email, work authorization, salary expectation, links, learned Q&A answers).

**Command routing**: global commands (`/verify-login`, `/tab`, `/set`, `/help`) always available. Tab-scoped commands (`/search-urls`, `/process-easy-queue`, etc.) only active/autocompleted when that tab is focused. Before `/verify-login` succeeds, only global commands work — everything else is locked with an explanatory message.

## Data Model

**`profile.json`**:
```json
{
  "contact": { "email": "jaswanthjas20@gmail.com", "phone": "", "location": "" },
  "workAuth": { "authorized": true, "requiresSponsorship": false },
  "experienceYears": 0,
  "salaryExpectation": { "min": 0, "max": 0, "currency": "USD" },
  "links": { "linkedin": "", "github": "", "portfolio": "" },
  "answers": { "<learned question text>": "<answer>" }
}
```
`answers` is the durable learned-answer store — replaces old `memory_facts` sqlite table. Living in a user-editable file (not buried in DB) is intentional: you can correct/curate learned answers directly.

**`resume.md`**: free text. Not parsed into fields. Used as LLM context, never as a source of structured facts.

**Postgres tables** (Drizzle):
- `jobs`: id, title, company, location, apply_url, apply_type (`easy`|`external`), source_url, status (`discovered`|`queued`|`needs_input`|`applied`|`failed`|`skipped`), relevance_reason, created_at, updated_at
- `applications`: id, job_id (fk), status (`applied`|`failed`|`needs_input`), result, screenshot_path, error, created_at
- `search_runs`: id, started_at, finished_at, urls_tried (jsonb), scanned_count, relevant_count, skipped_count — backs sidebar relevance stats
- *(no `memory_facts` table — superseded by `profile.json.answers`)*

**Config** (`linkedin-auto.config.ts`, schema trimmed from old repo):
```ts
{
  mustCheckUrls: string[]
  requirements: string
  concurrency: number          // default 1
  model: string
  profileFiles: { profile: string, resume: string }  // profile.json, resume.md
  search: { irrelevantBailRatio: number }             // default 0.5, configurable
}
```
No headless field — browser visibility isn't a setting, it's fixed always-visible.

## Phase 1 — Foundation

**Goal**: TUI shell + login bootstrap fully working end-to-end with stub agent commands, before any agent logic is written.

**TUI shell** (`@opentui/solid`, styling/layout patterns pulled from `opencode/packages/tui/src` — theme colors, borders, prompt component conventions):
- Top: session header bar — login state summary.
- Left: fixed-width sidebar, **scrollable** (independent scroll region — sidebar content can exceed terminal height on narrow/short terminals):
  - Login/session status block (LinkedIn: connected/waiting, Gmail: connected/waiting) — always visible, pinned.
  - Per-agent status rows (search / easy / external): idle/running/needs-input, current step text. `needs-input` rows are highlighted (accent color + marker) and show the pending question.
  - Stats block, content depends on focused tab: search tab → scanned/relevant/skipped tally + current URL/page; easy/external tab → queue remaining, applied-today count, current job.
- Main: active tab's scrolling log panel. 3 tabs: search / easy-apply / external-apply.
- Bottom: input box (opencode-style) — `/command args` with autocomplete scoped to active tab's commands + globals. When a job has an active `needs-input` prompt, the input box switches to plain-text answer mode (like old `PromptPanel`) instead of command mode.
- **Responsive**: whole layout reflows on terminal resize (opentui resize events). Log panel + input box are the primary surface and reflow first; sidebar collapses to a slim mode (or stacks) below a minimum width threshold rather than clipping.

**Tab switching**: Tab/Shift+Tab or Ctrl+1/2/3 cycles; `/tab search|easy|external` jumps explicitly.

**Browser bootstrap** (automatic, on TUI start):
1. Launch `AgentBrowser` (visible, one context).
2. Open tab 1 → `linkedin.com/login`, tab 2 → `mail.google.com`.
3. Sidebar shows both as "waiting for login."
4. All commands except `/verify-login`, `/tab`, `/set`, `/help` rejected with a message pointing at `/verify-login`.

**`/verify-login`**: checks LinkedIn tab for an authenticated DOM marker (nav/profile menu present) and Gmail tab for a loaded inbox. Both pass → sidebar flips to "connected," full command set unlocks. Either fails → names which one, stays locked, re-runnable.

**Global commands**: `/verify-login`, `/tab <name>`, `/set <key> <value>` (session overrides: concurrency, model, irrelevantBailRatio — no headless key), `/help`.

**Stub wiring**: `/search-urls`, `/search-describe`, `/search-resume`, `/process-easy-queue`, `/process-external-queue` registered and routed to the right tab's log panel with a "not implemented yet" response — proves the command/tab/sidebar framework works before agent logic exists.

**Definition of done**: `bun run dev` → browser opens visible → manually log into LinkedIn + Gmail → `/verify-login` succeeds → sidebar shows connected → tab switching and sidebar content-per-tab work → stub commands log into the correct tab → resizing the terminal doesn't break the layout.

## Phase 2 — Search Agent

**Commands** (search tab):
- `/search-urls` — run `config.mustCheckUrls` as-is.
- `/search-describe "<free text>"` — LLM turns the description into LinkedIn search URLs (old `search-url-generator.ts` pattern), then runs them.
- `/search-resume` — LLM reads `resume.md`, infers title/location/seniority filters, generates URLs, runs them.

**Scan loop** (per URL, inside the shared-browser mutex): navigate → for each job card, open detail, judge relevance against `resume.md` + `profile.json` + `config.requirements` (LLM call) → tag `relevant`/`skip` + `applyType` (easy/external, detected from the Apply button) → relevant jobs upserted into `jobs` (status `discovered`) and enqueued to the matching BullMQ queue. Every scanned job increments `search_runs.scanned_count`; relevant increments `relevant_count`.

**Bail logic**: per page (~25 cards), if `skipped/scanned >= config.search.irrelevantBailRatio` (default `0.5`, overridable via config or `/set irrelevantBailRatio <n>`): mark page done, advance to next URL in `mustCheckUrls`. When `mustCheckUrls` is exhausted and results are still thin, fall back to `search-url-generator` variants (title/location tweaks derived from resume + requirements), try those, then stop and report a summary (scanned/relevant/skipped, URLs tried) to the log + sidebar.

**Sidebar (search tab focused)**: live scanned/relevant/skipped tally for the in-progress `search_runs` row, current URL, current step (e.g. "scanning page 3 of ...").

**Needs-input**: reserved for genuinely stuck cases (LinkedIn checkpoint/verification challenge mid-scan) — same `NeedsInputError` mechanism as apply agents (below).

## Phase 3 — Easy-Apply Agent

**Command** (easy tab): `/process-easy-queue` — starts the BullMQ worker (`concurrency: 1`), pulls jobs one by one until queue empty or stopped (`/stop` or Esc).

**Per-job flow**: open `applyUrl` in the shared LinkedIn tab (same-site, no need for isolation) → click Easy Apply → step through the multi-step form. Field-filling precedence:
1. `profile.json` structured fields (contact, work auth, salary, years experience) — direct map.
2. `profile.json.answers` — fuzzy match on previously-learned question text.
3. LLM inference using `resume.md` + `profile.json` as combined context — handles free-text questions (e.g. "why this role") answerable from resume content.
4. Still unresolved (a genuine unknown, not inferable from either file) → throw `NeedsInputError(question)` → job status → `needs_input`, sidebar highlights the "easy" row with the question, logged in the easy-apply tab.

You answer via the input box (plain-text answer mode while a prompt is active) → answer written to `profile.json.answers` (never asked again) → job re-queued, resumes.

Submit → screenshot → `applications` row (`status: applied`, `screenshot_path`) → `jobs.status = applied`.

**Failure handling**: non-needs-input errors → `applications.status = failed` + `error` logged, worker moves to next job, never crashes.

**Sidebar (easy tab focused)**: queue remaining, applied-today count, current job title/company, needs-input flag + question if waiting.

## Phase 4 — External-Apply Agent

**Command** (external tab): `/process-external-queue` — same worker pattern, `concurrency: 1`.

**Per-job flow**: open `applyUrl` in a **new tab** in the shared browser context (external site, kept isolated from the LinkedIn tab). Navigate the application form using the same field-filling precedence as Phase 3.

**Email verification handling**: if the site requires account creation/email verification, submit with `profile.json.contact.email` → switch to the shared Gmail tab → search inbox for the verification email (sender/subject/recency heuristics) → extract OTP or click the verification link → switch back to the application tab, continue. Truly stuck cases (CAPTCHA, SMS-only 2FA, unrecognized flow) → `NeedsInputError` with context, same sidebar/prompt mechanism as Phase 3.

Submit → screenshot → same `applications`/`jobs` status updates as Phase 3.

**Sidebar (external tab focused)**: queue remaining, applied-today, current job, needs-input flag + question, and current external site domain (external forms vary a lot — "stuck on greenhouse.io step 3" is more useful here than for easy-apply).

## Error Handling

- `NeedsInputError` is the single recoverable-pause signal, unified across all three agents. Caught at worker level → job status `needs_input` → sidebar highlight → your answer routes back through the `AppState` prompt channel (tab-tagged so it reaches the right waiting job) → job resumes.
- All other thrown errors in a job handler → caught, `applications.status = failed` + `error` logged, worker continues to next job.
- Browser-level failures (page crash, LinkedIn checkpoint) → treated as `NeedsInputError` with a description — only a human can clear a checkpoint.
- Config/profile file errors (missing `resume.md`, invalid `profile.json`) → fail fast at startup, before the browser opens.

## Testing

- Unit (`vitest`, kept): config schema validation, `profile.json` parsing, bail-ratio math, command router (tab context + input string → resolved handler), field-filling precedence logic (mocked LLM calls).
- Component: TUI panels tested in isolation — confirm `@opentui/solid` supports headless/testable rendering during Phase 1 setup (equivalent to old `ink-testing-library` usage).
- No e2e tests against real LinkedIn (ToS risk, fragile). Phase 1's manual `bun run dev` walkthrough is the acceptance check for the shell + login flow; later phases get their own manual walkthroughs against real (or a throwaway) LinkedIn session rather than automated e2e.

## Build Order

1. Phase 1 (foundation) — spec'd above, build + verify first.
2. Phase 2 (search agent).
3. Phase 3 (easy-apply agent).
4. Phase 4 (external-apply agent).

Each phase gets its own implementation plan via `writing-plans`, built and verified in order — this doc holds full detail for all four so later phases don't lose context, but nothing past Phase 1 gets implemented until Phase 1 is verified working.
