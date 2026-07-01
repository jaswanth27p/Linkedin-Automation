import { createQueue } from './connection.ts'

export const deadLetterQueue = createQueue<unknown>('dead-letter')
