import pino from 'pino'
import { mkdirSync } from 'node:fs'
import { appEvents } from './app-events.ts'

mkdirSync('./data', { recursive: true })

export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: false, destination: './data/app.log' },
  },
})

export function logToTui(message: string) {
  appEvents.setState({ logs: [...appEvents.getState().logs, message].slice(-100) })
}
