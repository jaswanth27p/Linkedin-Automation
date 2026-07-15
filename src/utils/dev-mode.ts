/**
 * DEV_LOGS gates the noisy, developer-facing log lines shown in the TUI log
 * panel — the raw agent tool-call trace (`→ browser_goto`, `← browser_snapshot
 * (ok)`, etc.). With it off (the default) the panel shows only the natural-
 * language agent flow a normal user can follow. Everything still goes to the
 * on-disk log file (`data/app.log`) regardless — this only affects what the TUI
 * shows. Set `DEV_LOGS=true` (or `1`) in `.env` to see the raw trace live.
 */
export function isDevLogs(): boolean {
  const v = process.env.DEV_LOGS?.toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}
