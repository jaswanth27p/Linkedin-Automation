// A plain options object, not an IORedis instance — BullMQ vendors its own
// ioredis version, and passing a top-level `ioredis` instance trips a
// structural type mismatch between the two copies.
export interface RedisConnectionOptions {
  host: string
  port: number
  username?: string
  password?: string
  db?: number
  tls?: Record<string, never>
}

export function getRedisConnectionOptions(): RedisConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379')
  const dbPath = url.pathname.replace(/^\//, '')
  const db = dbPath ? Number(dbPath) : undefined

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(db !== undefined && !Number.isNaN(db) ? { db } : {}),
    // rediss:// (managed Redis providers) means TLS — without this the
    // connection just hangs against a TLS-only endpoint.
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  }
}
