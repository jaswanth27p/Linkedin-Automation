import IORedis from 'ioredis'
import { Queue } from 'bullmq'

export const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null })

export function createQueue<T>(name: string) {
  return new Queue<T>(name, { connection: redis as any })
}
