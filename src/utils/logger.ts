import pino, { type Logger } from 'pino'
import { mkdirSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { Writable } from 'node:stream'
import pinoPretty from 'pino-pretty'
import { appEvents } from './app-events.ts'

const DATA_DIR = './data'
const LOG_FILE = `${DATA_DIR}/app.log`

export function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true })
}

export function ensureLogDirectory() {
  ensureDataDir()
}

let _logger: Logger | null = null

export function createLogger(): Logger {
  ensureDataDir()

  const prettyStream = pinoPretty({ colorize: false })
  const fileStream = createWriteStream(LOG_FILE, { flags: 'a' })
  const tuiStream = new Writable({
    write(chunk, _encoding, callback) {
      const line = chunk.toString().trim()
      if (line) logToTui(line)
      callback()
    },
  })

  prettyStream.pipe(fileStream)
  prettyStream.pipe(tuiStream)

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

export function logToTui(message: string) {
  appEvents.setState({ logs: [...appEvents.getState().logs, message].slice(-100) })
}
