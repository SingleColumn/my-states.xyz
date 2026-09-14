/**
 * A failed write remains pending. Reporting an autosave error must not turn
 * flush() into success, and finishing an older write must not acknowledge a
 * newer edit. Keys coalesce only writes of the same complete record.
 */
export class SaveQueue {
  private pending = new Map<string, () => Promise<void>>()
  private running: Promise<void> | null = null

  constructor(private readonly onError: (error: unknown) => void) {}

  get hasPending() { return this.pending.size > 0 }

  enqueue(key: string, write: () => Promise<void>) {
    this.pending.set(key, write)
    // Observe rejection here for background saves, without changing the
    // promise returned to a caller waiting for durable completion.
    void this.start().catch(() => {})
  }

  async flush() {
    do {
      await this.start()
    } while (this.pending.size)
  }

  private start(): Promise<void> {
    if (this.running) return this.running
    let failed = false
    this.running = this.drain().catch((error) => {
      failed = true
      this.onError(error)
      throw error
    }).finally(() => {
      this.running = null
      // An enqueue can arrive between drain resolving and this continuation.
      if (!failed && this.pending.size) void this.start().catch(() => {})
    })
    return this.running
  }

  private async drain() {
    while (this.pending.size) {
      const [key, write] = this.pending.entries().next().value!
      await write()
      if (this.pending.get(key) === write) this.pending.delete(key)
    }
  }
}
