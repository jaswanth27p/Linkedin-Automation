# LinkedIn Auto-Apply

A terminal agent that opens a real, visible browser, waits for you to log into LinkedIn and Gmail by hand, then searches and applies to jobs on your behalf — asking for input only when it genuinely needs it.

## Setup

1. `bun install`
2. `docker compose up -d` (Redis + Postgres) — or point `DATABASE_URL` in `.env` at an existing local Postgres instance if port 5432 is already in use
3. `bun run db:push`
4. `cp resume.example.md resume.md` and `cp profile.example.json profile.json`, then fill in your real details. Both files are gitignored.
5. `bun run dev`

## Status

Phase 1 (TUI shell, shared-browser login bootstrap, command framework): implemented.
Phase 2 (search agent), Phase 3 (easy-apply agent), Phase 4 (external-apply agent): not yet implemented — see `docs/superpowers/specs/2026-07-14-tui-rebuild-design.md` for the full design.
