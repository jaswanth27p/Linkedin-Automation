# LinkedIn Auto-Apply

A terminal application that searches LinkedIn for jobs matching your resume and requirements, and applies to them for you — one at a time, in a real browser window you can watch, stepping in only when it genuinely needs your input (a form question it can't answer, an email verification code, a login checkpoint).

It does **not** store or ask for your LinkedIn password. You log in by hand, once, in a visible browser window the app opens; from then on it reuses that logged-in session.

## What it does

- **Search** — runs LinkedIn job searches (from a config file, a plain-English description, or inferred from your resume), judges each result against your resume/profile/requirements, and queues the relevant ones.
- **Easy Apply** — works through LinkedIn's own "Easy Apply" queue, filling out the multi-step form for each job.
- **External Apply** — works through jobs that apply on the company's own site, opening each in its own browser tab (including simple account-creation/email-verification flows), and asking you for the verification code when one is required.
- **Learns as it goes** — the first time it hits a question it can't answer on its own, it asks you once, then remembers the answer (`profile.json`) so it's never asked again.
- **Never applies blind** — every job goes into a Postgres table with a status and (for applications) a screenshot, so you have a record of what was actually submitted.

## How it works (short version)

One Bun process runs everything: a terminal UI (three tabs — Search / Easy Apply / External Apply), a background browser it drives via [Playwright](https://playwright.dev/) over Chrome DevTools Protocol, and three [Mastra](https://mastra.ai/) AI agents (search, easy-apply, external-apply) that each get their own set of tools (navigate, click, type, plus a handful of app-specific ones) and figure out the actual steps themselves — they're not scripted click-sequences, so they adapt to whatever a given job posting or apply form actually looks like. Search results and application records live in Postgres; the queue between "found a relevant job" and "applied to it" is BullMQ/Redis.

For the full technical design (and where the real implementation differs from the original plan), see [`docs/superpowers/specs/2026-07-14-tui-rebuild-design.md`](docs/superpowers/specs/2026-07-14-tui-rebuild-design.md). For codebase-level orientation, see [`CLAUDE.md`](CLAUDE.md).

## Requirements

- [Bun](https://bun.sh/) (this project runs entirely on Bun — no Node.js needed to run it, though Playwright's browser download requires the usual OS dependencies)
- [Docker](https://www.docker.com/) (for Postgres + Redis — or point at existing instances of both, see below)
- An [OpenCode Zen](https://opencode.ai/docs/zen) API key (`OPENCODE_API_KEY`) — this is what powers every agent's LLM calls. Free/low-cost models are available; see the model notes below.
- A LinkedIn account you're comfortable automating job applications from. **You are responsible for how you use this tool against LinkedIn's Terms of Service** — this project doesn't attempt to hide or disguise its automation.

## Setup

1. **Install dependencies**

   ```bash
   bun install
   ```

   If `bun install` prompts about untrusted postinstall scripts, run:

   ```bash
   bun pm untrusted   # confirm agent-browser / playwright-core are listed
   bun pm trust agent-browser playwright-core
   ```

   This lets Playwright download its bundled Chromium — required for the browser the app drives.

2. **Start Postgres and Redis**

   ```bash
   docker compose up -d
   ```

   This maps Postgres to host port `5433` and Redis to `6380` (not the defaults — deliberately remapped so this doesn't collide with other Postgres/Redis instances you might already be running). If you'd rather point at existing instances instead, skip this step and edit `DATABASE_URL`/`REDIS_URL` in `.env` (step 3).

3. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Then edit `.env`:

   | Variable | Required | Description |
   |---|---|---|
   | `OPENCODE_API_KEY` | Yes | Your OpenCode Zen API key — every agent's LLM calls fail without this. |
   | `MASTRA_MODEL` | No | Unused by the app directly (the model is set in `linkedin-auto.config.ts` instead) — left here for reference. |
   | `DATABASE_URL` | Yes | Postgres connection string. Defaults to the `docker compose` instance above. |
   | `REDIS_URL` | Yes | Redis connection string. Defaults to the `docker compose` instance above. |

4. **Push the database schema**

   ```bash
   bun run db:push
   ```

5. **Set up your resume and profile**

   ```bash
   cp resume.example.md resume.md
   cp profile.example.json profile.json
   ```

   Edit both with your real information (see [Configuration](#configuration) below for what each field means). **Both files are gitignored** — they hold personal data and are never meant to be committed.

6. **Configure what to search for**

   Edit `linkedin-auto.config.ts` (see [Configuration](#configuration) below).

7. **Run it**

   ```bash
   bun run dev
   ```

   A visible Chrome window opens to the LinkedIn login page. Log in by hand. Back in the terminal, run `/verify-login` — once it confirms you're logged in, every command unlocks.

## Configuration

### `linkedin-auto.config.ts`

```ts
export default {
  mustCheckUrls: [                    // LinkedIn search-results URLs to run with /search-urls
    'https://www.linkedin.com/jobs/search/?f_TPR=r86400&keywords=software%20engineer',
  ],
  requirements: `                     // Free text — what you're actually looking for.
    Look for senior backend / full-stack engineering roles.
    Prefer remote or hybrid in the US.
    Avoid roles requiring more than 8 years of experience.
  `,
  concurrency: 1,                     // Reserved for future use; queue workers currently always run at concurrency 1.
  profileFiles: {
    resume: './resume.md',
    profile: './profile.json',
  },
  model: 'opencode-go/deepseek-v4-flash',  // 'provider/model' — see Model notes below.
  search: {
    irrelevantBailRatio: 0.5,         // Bail out of a search results page once this fraction of scanned jobs are irrelevant.
  },
} satisfies AppConfig
```

`model` and `search.irrelevantBailRatio` can also be changed at runtime without restarting, via `/set model <name>` and `/set irrelevantBailRatio <0-1>` in the app.

### `profile.json`

Structured facts the agents use to fill forms directly, without needing to ask you or infer from your resume:

```json
{
  "contact": { "email": "you@example.com", "phone": "", "location": "" },
  "workAuth": { "authorized": true, "requiresSponsorship": false },
  "experienceYears": 5,
  "salaryExpectation": { "min": 0, "max": 0, "currency": "USD" },
  "links": { "linkedin": "", "github": "", "portfolio": "" },
  "answers": {}
}
```

`answers` starts empty and fills in on its own — every time an agent asks you a question it can't otherwise answer, your reply gets saved here (keyed by the question text) so it's never asked again. You can also hand-edit this file directly if you want to pre-fill or correct an answer.

### `resume.md`

Free text — your resume, in Markdown or plain text. Used as LLM context for relevance judging and for answering free-text application questions ("why are you a good fit for this role", etc.). Not parsed into structured fields, so formatting doesn't matter much; content does.

### Model notes

`model` is a `'provider/model'` string resolved by Mastra's model router against your `OPENCODE_API_KEY`. This project defaults every agent to **`opencode-go/deepseek-v4-flash`** — fast, cheap, and sufficient since none of the agents need image/vision understanding (they read pages as structured accessibility snapshots, not screenshots). If you need a vision-capable model for some reason, `opencode-go/mimo-v2.5` is available from the same provider.

## Usage

Once `/verify-login` succeeds, every command below is available. Commands are scoped to a tab — `Tab`/`Shift+Tab` cycles between Search / Easy Apply / External Apply, or jump directly with `/tab <name>`.

| Command | Tab | What it does |
|---|---|---|
| `/verify-login` | global | Check LinkedIn login status; unlocks the app once it passes |
| `/tab <search\|easy\|external>` | global | Switch the active tab |
| `/set <concurrency\|model\|irrelevantBailRatio> <value>` | global | Change a runtime setting without restarting |
| `/help` | global | List commands available on the current tab |
| `/exit` | global | Close the browser and quit (`Ctrl+Q` also works) |
| `/search-urls` | search | Run the URLs from `linkedin-auto.config.ts`'s `mustCheckUrls` |
| `/search-describe <free text>` | search | Turn a plain-English description into search URLs, then run them |
| `/search-resume` | search | Infer search filters from `resume.md`, then run them |
| `/stop-search` | search | Stop an in-progress search run |
| `/process-easy-queue` | easy | Start working through queued Easy Apply jobs |
| `/stop-easy-queue` | easy | Stop the Easy Apply worker |
| `/process-external-queue` | external | Start working through queued external-apply jobs |
| `/stop-external-queue` | external | Stop the external-apply worker |

**When an agent needs your input** — an application question it can't answer, an email verification code, a stuck checkpoint — the input box automatically switches from command mode to plain-text answer mode (the sidebar highlights which tab is waiting, and shows the question). Just type your answer and press Enter; the agent resumes with it.

**Ctrl+Q** exits the app. **Ctrl+C is intentionally left alone** so your terminal's own copy-selected-text shortcut keeps working.

## Data and privacy

- Your LinkedIn password is never read, stored, or requested by this app. Login happens by hand, in a real, visible browser window.
- `resume.md` and `profile.json` are sent to the configured LLM provider (OpenCode Zen) as context for every agent call — review OpenCode's data handling policy if that matters for your use case.
- `resume.md`, `profile.json`, and everything under `data/` (logs, browser session state, application screenshots) are gitignored and stay local to your machine.
- Application screenshots are saved to `data/screenshots/` as proof of what was actually submitted.

## Development

- `bun run typecheck` — TypeScript, no emit.
- `bun test` — full test suite (Bun's native test runner; requires Postgres/Redis running per Setup step 2).
- `bun test tests/unit/commands/dispatch.test.ts` — run a single test file.
- `bun test -t "some test name"` — filter by test name.

There's no automated end-to-end test against real LinkedIn or real job sites — by design (ToS risk, fragility of testing against someone else's live UI). Unit and DB-integration tests cover the logic; running the app for real against your own LinkedIn account is the acceptance check.

## Troubleshooting

- **`bun run dev` fails immediately with a Postgres/Redis connection error** — confirm `docker compose ps` shows both containers healthy, and that `DATABASE_URL`/`REDIS_URL` in `.env` match the ports `docker-compose.yml` actually exposes (`5433`/`6380` by default).
- **A command says "not implemented" or does nothing** — make sure `/verify-login` has succeeded first; every command except the global ones is locked until then.
- **Login doesn't persist across restarts** — check that `data/browser-storage-state.json` isn't stuck at `{"cookies":{}}` (should be an array, e.g. `{"cookies":[...]}`); delete it and log in again if so.
- **The app hangs and won't exit after `/exit`** — this shouldn't happen (queue workers and the DB pool are stopped on shutdown), but if it does, `Ctrl+Break`/closing the terminal window will force it.

## Project status

All four phases are implemented: the TUI shell and login bootstrap, the search agent, the easy-apply agent, and the external-apply agent. See the [design spec](docs/superpowers/specs/2026-07-14-tui-rebuild-design.md) for full detail on each, including where the real implementation ended up deviating from the original plan.
