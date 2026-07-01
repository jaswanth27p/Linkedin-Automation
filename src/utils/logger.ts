import pino from 'pino'
import { mkdirSync } from 'node:fs'
import { appEvents } from './app-events.ts'

const LOG_DIR = './data'
const LOG_FILE = `${LOG_DIR}/app.log`

export function ensureLogDirectory() {
  mkdirSync(LOG_DIR, { recursive: true })
}

export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: false, destination: LOG_FILE },
  },
})

export function logToTui(message: string) {
  appEvents.setState({ logs: [...appEvents.getState().logs, message].slice(-100) })
}
