# LinkedIn Job Automation — Design Spec

Date: 2026-07-01  
Status: Approved

## Overview

Build a local-first, TUI-driven application that uses **Mastra AI browser agents** to search LinkedIn for jobs, classify them as Easy Apply or external apply, and apply on the user's behalf. The app runs as a single long-running Node process controlled through a terminal UI (similar to OpenCode). It uses **BullMQ** queues for sequential processing and **Mastra memory** to remember profile data and learned answers.

## Goals

- Automate LinkedIn job discovery and application entirely through Mastra browser agents.
- Combine fixed search URLs with LLM-generated searches from natural-language requirements.
- Run two search rhythms: frequent recent-only search and periodic broad search.
- Provide a TUI to start/pause/stop runs, view status/logs, and answer agent questions in real time.
- Remember missing answers so the agent does not ask the same question twice.

## Non-goals

- Web dashboard (TUI only for now).
- Multi-account support.
- Human review before every application (fully auto-submit).

## Architecture

Single TypeScript project. One process runs the TUI, scheduler, queues, and workers. The browser is treated as a single shared context with global concurrency set to `1`, so search and apply agents never fight each other.

```
┌─────────────────────────────────────────────────────────────┐
│  CLI entry (src/cli.ts)                                     │
│  └─ TUI (Ink) ── controls embedded server                   │
│         │                                                   │
│         ▼                                                   │
│  Scheduler ── enqueues search jobs (BullMQ + Redis)         │
│         │                                                   │
│         ▼                                                   │
│  Search Agent (Mastra browser agent)                        │
│    - opens fixed URLs from config                           │
│    - generates extra URLs from natural-language rules       │
│    - visits jobs, scores relevance, copies links            │
│    - enqueues to easyApplyQueue / externalApplyQueue        │
│         │                                                   │
│         ▼                                                   │
│  Apply Agents (Mastra browser agents)                       │
│    - EasyApplyAgent submits LinkedIn Easy Apply forms       │
│    - ExternalApplyAgent tries external sites, pauses if lost│
│         │                                                   │
│         ▼                                                   │
│  Profile / Memory ── resume.md + profile.md + learned facts │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 20+, TypeScript, `tsx` |
| TUI | Ink + React with layout boxes/borders (not line-by-line output) |
| HTTP/API | Fastify (lightweight, optional API surface) |
| Queues / scheduler | BullMQ + Redis |
| AI / browser | Mastra (browser tool, agents, memory) |
| LLM provider | OpenCode Go (`opencode-go/kimi-k2.7-code` default) |
| Database | SQLite for local dev; Postgres for cloud |
| ORM | Drizzle or Prisma |
| Logging | pino |
| Config | TypeScript config file + Markdown profile |
| Container | Docker Compose for local services (Redis + optional Postgres) |

## Components

### 1. Config (`linkedin-auto.config.ts`)

Exports:

- `mustCheckUrls`: array of LinkedIn search URLs that are always checked.
- `requirements`: natural-language rules the agent uses to generate extra searches and filter jobs.
- `cron`: `{ recent: { intervalMinutes, postedWithinMinutes }, full: { intervalMinutes } }`.
- `concurrency`: `1` (single browser context).
- `model`: Mastra model string; default `opencode-go/kimi-k2.7-code`.
- `profileFiles`: paths to `profile.md` and `resume.pdf`.

### 2. Profile / Memory

- `profile.md` and `resume.pdf` are loaded at startup and injected into every agent system prompt.
- Mastra Memory stores facts learned during human-in-the-loop interactions.
- A DB table `memory_facts(question, answer, createdAt)` persists answers independently of Mastra's runtime memory.

### 3. Search Agent

Triggered by cron or TUI command.

1. Loads `mustCheckUrls`.
2. Uses an LLM call with `requirements` + `profile` to generate extra LinkedIn search URLs/queries.
3. Opens each URL in the browser, scrapes job cards.
4. Visits each job detail page, scores relevance, determines apply type (Easy Apply vs external).
5. Enqueues relevant jobs to `easyApplyQueue` or `externalApplyQueue` with job metadata.

### 4. Apply Agents

- **EasyApplyAgent**: opens the job, clicks Easy Apply, fills the form using the profile, uploads the resume, submits, and records the result.
- **ExternalApplyAgent**: opens the external apply URL and attempts to complete the flow. If it encounters an unknown question or flow, it pauses the job and asks the user via the TUI.

### 5. Queues

- `searchQueue`: triggers the search agent.
- `easyApplyQueue`: processes Easy Apply applications one by one.
- `externalApplyQueue`: processes external applications one by one.

All workers run with concurrency `1`. A global lock ensures only one Mastra browser agent uses the browser context at a time.

### 6. Scheduler

- **Recent search cron**: e.g., every 60 minutes using a LinkedIn `posted within last N minutes/hours` filter.
- **Full search cron**: e.g., every 24 hours with no recent filter.
- The TUI can also trigger one-off searches or time-boxed runs (`run X times`, `run for N hours`, `run until I stop`).

### 7. TUI

Built with **Ink + React** using box-based layout (borders, flex columns/rows) so it looks like a small dashboard, not a scrolling line-by-line CLI. Main panels:

- **Top bar**: current mode, run status, next cron times.
- **Left sidebar / menu**: start recent search, full search, apply-only mode, run until stopped, run N times, run N hours.
- **Center status panel**: active agent, current job title/company, queue counts, progress.
- **Bottom-left logs panel**: tail of pino logs inside a bordered box.
- **Bottom-right prompts panel**: when an agent needs missing info, it shows the question and a focused input box; the answer is saved to memory and the job resumes.
- **Global controls**: pause / resume / stop shortcuts.

Layout is built with Ink `Box` components, fixed heights, and border styling so panels stay visible together.

## Data Flow

1. User runs `npm run start` → TUI opens.
2. User selects a run mode → scheduler enqueues a `searchQueue` job.
3. Search agent discovers jobs and enqueues relevant ones to apply queues.
4. Apply agents process jobs sequentially, updating the database with status.
5. If an agent needs missing information, the job moves to `needs_input`, the TUI prompts the user, the answer is stored in memory, and the job resumes.

## Error Handling

- BullMQ provides exponential backoff and a dead-letter queue after max retries.
- On failure, the agent captures a screenshot to `data/screenshots/<jobId>-<timestamp>.png`.
- LinkedIn session cookies are persisted between runs to reduce login friction.
- Network / rate-limit errors trigger a cooldown before retry.

## Run Modes

- `npm run start` — opens TUI and starts the embedded server/workers.
- `npm run server` — headless server mode for cloud/VPS.
- (Future) `npm run tui -- --url http://...` — TUI connecting to a remote server.

## Deployment

- Local: run directly with Node + Docker Compose for Redis/Postgres.
- Cloud/VPS: run `npm run server` inside a long-running container with persistent storage for cookies and screenshots.

## Risks

LinkedIn's User Agreement prohibits automated job applications. Using this tool can result in account restrictions or bans. Recommended mitigations:

- Use a dedicated LinkedIn account.
- Add generous delays between actions.
- Limit daily application volume.
- Keep screenshots and logs to audit behavior.

## Open Questions

- Fallback notification channel when the TUI is not open? (Deferred.)
- Coverage strategy for external apply sites? (Deferred; agent will pause and ask.)
