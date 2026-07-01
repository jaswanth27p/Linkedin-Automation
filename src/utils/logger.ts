import pino, { type Logger } from 'pino'
import { mkdirSync } from 'node:fs'
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
  _logger = pino({
    transport: {
      target: 'pino-pretty',
      options: { colorize: false, destination: LOG_FILE },
    },
  })
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
