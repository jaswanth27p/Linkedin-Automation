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
