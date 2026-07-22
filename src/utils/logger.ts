import pino, { type Logger } from 'pino'
import { mkdirSync } from 'node:fs'
import pinoPretty from 'pino-pretty'

const DATA_DIR = './data'
const LOG_FILE = `${DATA_DIR}/app.log`

export function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true })
}

let _logger: Logger | null = null

export function createLogger(): Logger {
  ensureDataDir()

  // CRITICAL: logs must NEVER touch stdout. opentui owns the terminal while the
  // TUI is running, so any stray stdout write interleaves with its frames —
  // log lines appear below/over the TUI and the whole layout looks broken until
  // a resize forces a full repaint. `pinoPretty()` with no `destination`
  // defaults to process.stdout, which was exactly the bug. Route pino-pretty
  // straight to the log file instead — nothing goes to stdout.
  const prettyStream = pinoPretty({
    colorize: false,
    destination: LOG_FILE,
    append: true,
    mkdir: true,
  })

  _logger = pino(prettyStream)
  return _logger
}

export const logger = new Proxy({} as Logger, {
  get(_target, prop) {
    if (!_logger) {
      createLogger()
    }
    const value = (_logger as Logger)[prop as keyof Logger]
    // Bind methods to the real pino instance — calling them with the proxy as
    // `this` makes pino's internal symbol lookups go back through this handler
    // on every access, and any internal `this` mutation would silently miss.
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(_logger) : value
  },
})
