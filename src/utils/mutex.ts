export class Mutex {
  private promise: Promise<unknown> = Promise.resolve()

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.promise.then(async () => fn())
    this.promise = next.catch(() => {})
    return next
  }
}

const globalLock = new Mutex()
export function getBrowserLock() {
  return globalLock
}
