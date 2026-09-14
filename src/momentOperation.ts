/** A moment operation holds input still from its first flush through its
 * final handoff. Failures release input, but must not run the next step. */
export class MomentOperation {
  private busy = false
  private pause: ((paused: boolean) => void) | null = null
  get isBusy() { return this.busy }

  registerPause(handler: (paused: boolean) => void) {
    this.pause = handler
    handler(this.busy)
    return () => { if (this.pause === handler) this.pause = null }
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Please wait for the current moment operation to finish.')
    this.busy = true
    try {
      this.pause?.(true)
      return await work()
    } finally {
      this.busy = false
      this.pause?.(false)
    }
  }
}
